import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, Server } from 'node:https';
import { AddressInfo, LookupFunction } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ImageModerator, ModerationVerdict } from '../src/photos/moderator.js';
import { blockedDomain, checkImageUrl, fetchImage, fetchOptions, isPrivateAddress, sanitizeImage } from '../src/photos/safe-image.js';
import { MemoryPhotoStore } from '../src/photos/store.js';
import { Ctx, loginAs, setup, teardown } from './helpers.js';

const photo = (w = 200, h = 150) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 60 } } });

/* Faux site HTTPS : « photos.test » et « interne.test » pointent sur 127.0.0.1 (et 10.0.0.1 pour le second). */
let server: Server;
let port = 0;
let jpegWithGps: Buffer;
const originalLookup = fetchOptions.lookup;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'th-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=photos.test'], {
    stdio: 'ignore',
  });
  jpegWithGps = await photo().withExif({ IFD0: { Copyright: 'secret', Artist: 'Espion' } }).jpeg().toBuffer();
  const png = await photo().png().toBuffer();
  server = createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (req, res) => {
    const url = req.url ?? '';
    if (url === '/photo.jpg') return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(jpegWithGps);
    if (url === '/photo.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(png);
    if (url === '/page') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html>pub</html>');
    if (url === '/svg') return res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    if (url === '/huge') return res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(20 * 1024 * 1024) }).end();
    if (url === '/vers-photo') return res.writeHead(302, { location: '/photo.png' }).end();
    if (url === '/vers-http') return res.writeHead(302, { location: 'http://photos.test/photo.png' }).end();
    if (url === '/vers-interne') return res.writeHead(302, { location: 'https://interne.test/photo.png' }).end();
    if (url === '/vers-court') return res.writeHead(302, { location: 'https://bit.ly/abc' }).end();
    return res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  // Résolution de test : le vrai contrôle des adresses s'applique, sauf à la boucle locale du faux site.
  const lookup: LookupFunction = (hostname, options, callback) => {
    const address = hostname === 'photos.test' ? '127.0.0.1' : hostname === 'interne.test' ? '10.0.0.1' : null;
    const cb = callback as (e: Error | null, a: string, f: number) => void;
    if (!address) return cb(new Error('inconnu'), '', 0);
    if (address !== '127.0.0.1' && isPrivateAddress(address)) return cb(new Error(`adresse non publique (${address})`), '', 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family: 4 }]);
    return cb(null, address, 4);
  };
  fetchOptions.lookup = lookup;
  fetchOptions.extra = { rejectUnauthorized: false };
});
afterAll(async () => {
  fetchOptions.lookup = originalLookup;
  fetchOptions.extra = {};
  await new Promise<void>((r) => server.close(() => r()));
});

const at = (path: string) => `https://photos.test:${port}${path}`;

describe('photos venues de l’extérieur : liens', () => {
  it('refuse les adresses internes et réservées', () => {
    for (const a of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.20.0.1', '100.64.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1', '0.0.0.0']) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:93.184.216.34']) expect(isPrivateAddress(a)).toBe(false);
  });

  it('n’accepte que des liens https vers un nom de domaine public, ni raccourci ni régie', () => {
    expect(checkImageUrl('https://upload.wikimedia.org/a.jpg').hostname).toBe('upload.wikimedia.org');
    const refused = [
      'http://exemple.fr/a.jpg',
      'ftp://exemple.fr/a.jpg',
      'javascript:alert(1)',
      'https://93.184.216.34/a.jpg',
      'https://[::1]/a.jpg',
      'https://user:pass@exemple.fr/a.jpg',
      'https://exemple.fr:8443/a.jpg',
      'https://nas.local/a.jpg',
      'https://localhost/a.jpg',
      'https://bit.ly/xyz',
      'https://ads.doubleclick.net/a.jpg',
      'pas un lien',
    ];
    for (const url of refused) expect(() => checkImageUrl(url), url).toThrow();
    expect(blockedDomain('static.criteo.net')).toBe(true);
    expect(blockedDomain('notcriteo.net')).toBe(false);
  });
});

describe('photos venues de l’extérieur : réencodage', () => {
  it('garde les pixels, retire les métadonnées et ce qui suit l’image', async () => {
    const trapped = Buffer.concat([jpegWithGps, Buffer.from('<script>alert(1)</script>MZ\x90\x00 charge cachée')]);
    const out = await sanitizeImage(trapped);
    expect(out.contentType).toBe('image/jpeg');
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(200);
    expect(out.bytes.includes(Buffer.from('script'))).toBe(false);
    expect(out.bytes.includes(Buffer.from('Espion'))).toBe(false);
  });

  it('réduit les grandes images et refuse SVG, minuscules et faux fichiers', async () => {
    const big = await sanitizeImage(await photo(4000, 3000).png().toBuffer());
    expect((await sharp(big.bytes).metadata()).width).toBe(1600);
    await expect(sanitizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"/>'))).rejects.toThrow(/Format|lisible/);
    await expect(sanitizeImage(await photo(10, 10).png().toBuffer())).rejects.toThrow(/petite/);
    await expect(sanitizeImage(Buffer.from('MZ\x90\x00 pas une image du tout'))).rejects.toThrow(/lisible/);
  });
});

describe('photos venues de l’extérieur : téléchargement', () => {
  // Le faux site écoute sur un port inhabituel : le lien est écrit sans port, la connexion le prend.
  const viaPort = (path: string) => at(path).replace(`:${port}`, '');
  beforeAll(() => {
    fetchOptions.extra = { rejectUnauthorized: false, port };
  });

  it('télécharge et réencode une photo, en suivant une redirection', async () => {
    const direct = await fetchImage(viaPort('/photo.jpg'), true);
    expect(direct.contentType).toBe('image/jpeg');
    expect((await sharp(direct.bytes).metadata()).exif).toBeUndefined();
    const moved = await fetchImage(viaPort('/vers-photo'), true);
    expect(moved.finalUrl).toBe(viaPort('/photo.png'));
  });

  it('refuse une page, un SVG, un fichier trop lourd, et les redirections douteuses', async () => {
    await expect(fetchImage(viaPort('/page'), true)).rejects.toThrow(/page, pas à une image/);
    await expect(fetchImage(viaPort('/svg'), true)).rejects.toThrow(/Format|lisible/);
    await expect(fetchImage(viaPort('/huge'), true)).rejects.toThrow(/trop lourde/);
    await expect(fetchImage(viaPort('/vers-http'), true)).rejects.toThrow(/https/);
    await expect(fetchImage(viaPort('/vers-court'), true)).rejects.toThrow(/raccourcis/);
    await expect(fetchImage(viaPort('/vers-interne'), true)).rejects.toThrow(/Impossible de récupérer/);
  });
});

/** Contrôleur scripté : refuse les photos tant que `refuse` est posé ; `down` simule une panne. */
class ScriptedModerator implements ImageModerator {
  refuse: string | null = null;
  down = false;
  seen = 0;
  async review(): Promise<ModerationVerdict> {
    this.seen++;
    if (this.down) throw new Error('API indisponible');
    return this.refuse ? { ok: false, reason: this.refuse } : { ok: true, reason: '' };
  }
}

describe('photos d’étape : API', () => {
  let ctx: Ctx;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const store = new MemoryPhotoStore();
  const moderator = new ScriptedModerator();
  beforeAll(async () => {
    ctx = await setup();
    app = await buildApp(ctx.pool, { photoStore: store, moderator });
    fetchOptions.extra = { rejectUnauthorized: false, port };
  });
  afterAll(async () => {
    await app.close();
    await teardown(ctx);
  });

  it('importe une photo par lien, la réencode, et la refuse si l’IA y voit de la publicité', async () => {
    const camille = await loginAs(app, 'camille@example.com');
    const step = (await camille.get('/api/hunts/1/steps')).body.find((s: { order: number }) => s.order === 1);
    const url = at('/photo.jpg').replace(`:${port}`, '');

    const ok = await camille.put(`/api/steps/${step.id}/reference-photo`, { url });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ referencePhoto: true, photoCredit: null });
    const stored = [...store.objects.values()].at(-1)!;
    expect((await sharp(stored.bytes).metadata()).exif).toBeUndefined();
    const source = await ctx.pool.query('SELECT cod_photosource FROM th_codes WHERE cod_id = $1', [step.id]);
    expect(source.rows[0].cod_photosource).toBe(url);

    moderator.refuse = 'Cette image est une publicité.';
    const ad = await camille.put(`/api/steps/${step.id}/reference-photo`, { url });
    expect(ad.status).toBe(422);
    expect(ad.body.message).toBe('Photo refusée : Cette image est une publicité.');

    // L'IA en panne ne bloque pas l'organisateur.
    moderator.refuse = null;
    moderator.down = true;
    expect((await camille.put(`/api/steps/${step.id}/reference-photo`, { url })).status).toBe(200);
    moderator.down = false;

    expect((await camille.put(`/api/steps/${step.id}/reference-photo`, { url: 'http://exemple.fr/a.jpg' })).status).toBe(400);
    const seb = await loginAs(app, 'seb@example.com');
    expect((await seb.put(`/api/steps/${step.id}/reference-photo`, { url })).status).toBe(403);
  });

  it('réencode aussi les photos envoyées depuis le téléphone', async () => {
    const camille = await loginAs(app, 'camille@example.com');
    const step = (await camille.get('/api/hunts/1/steps')).body.find((s: { order: number }) => s.order === 2);
    const image = `data:image/jpeg;base64,${jpegWithGps.toString('base64')}`;
    expect((await camille.put(`/api/steps/${step.id}/reference-photo`, { image })).status).toBe(200);
    const key = (await ctx.pool.query('SELECT cod_refphoto, cod_photosource FROM th_codes WHERE cod_id = $1', [step.id])).rows[0];
    expect(key.cod_photosource).toBeNull();
    expect((await sharp(store.objects.get(key.cod_refphoto)!.bytes).metadata()).exif).toBeUndefined();
  });
});
