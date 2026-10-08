import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoPlan } from '../../shared/generation.js';
import { GenerationRequest } from '../../shared/models.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { GeneratedHunt, HuntGenerator, withPhotos } from '../src/generation/generator.js';
import { freeLicense, freePhotoFor, plainText } from '../src/photos/commons.js';
import { MemoryPhotoStore } from '../src/photos/store.js';
import { Ctx, loginAs, setup, teardown } from './helpers.js';

/** Faux Commons et Wikidata : fichiers connus, photos géolocalisées, fiches Wikidata. */
const FILES: Record<string, { license: string; short: string; artist: string; mime?: string }> = {
  'File:Fontaine de la Licorne.jpg': { license: 'cc-by-sa-4.0', short: 'CC BY-SA 4.0', artist: '<a href="//commons.wikimedia.org/wiki/User:Jean">Jean D&#39;Arc</a>' },
  'File:Tour Eiffel nuit.jpg': { license: 'cc-by-nc-2.0', short: 'CC BY-NC 2.0', artist: 'Pierre' },
  'File:Statue du fondateur.jpg': { license: 'cc0', short: 'CC0', artist: '' },
  'File:Kiosque à musique, Montpellier.jpg': { license: 'pd', short: 'Public domain', artist: 'Anonyme' },
};
let server: Server;
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    hits.push(`${url.pathname}?${url.searchParams.get('action')}`);
    const json = (body: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/wikidata') {
      const id = url.searchParams.get('entity');
      return json({ claims: id === 'Q1' ? { P18: [{ mainsnak: { datavalue: { value: 'Statue du fondateur.jpg' } } }] } : {} });
    }
    if (url.searchParams.get('list') === 'geosearch') {
      return json({ query: { geosearch: [{ title: 'File:Rue quelconque.jpg' }, { title: 'File:Kiosque à musique, Montpellier.jpg' }] } });
    }
    const title = url.searchParams.get('titles') ?? '';
    const f = FILES[title];
    if (!f) return json({ query: { pages: [{ missing: true }] } });
    return json({
      query: {
        pages: [
          {
            imageinfo: [
              {
                thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}`,
                descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
                mime: f.mime ?? 'image/jpeg',
                extmetadata: { License: { value: f.license }, LicenseShortName: { value: f.short }, Artist: { value: f.artist } },
              },
            ],
          },
        ],
      },
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config.commonsApiUrl = `${base}/commons`;
  config.wikidataApiUrl = `${base}/wikidata`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('photos libres : licences', () => {
  it('ne garde que les licences libres réutilisables', () => {
    const m = (license: string, short: string, nonFree?: string) => ({ License: { value: license }, LicenseShortName: { value: short }, NonFree: { value: nonFree } });
    expect(freeLicense(m('cc-by-sa-4.0', 'CC BY-SA 4.0'))).toBe('CC BY-SA 4.0');
    expect(freeLicense(m('cc0', 'CC0'))).toBe('CC0');
    expect(freeLicense(m('pd', 'Public domain'))).toBe('Public domain');
    expect(freeLicense(m('cc-by-nc-2.0', 'CC BY-NC 2.0'))).toBeNull();
    expect(freeLicense(m('cc-by-nd-4.0', 'CC BY-ND 4.0'))).toBeNull();
    expect(freeLicense(m('', 'Fair use', 'true'))).toBeNull();
    expect(freeLicense(m('arr', 'All rights reserved'))).toBeNull();
    expect(plainText('<a href="x">Jean&nbsp;D&#39;Arc</a> <span>(photo)</span>')).toBe('Jean D’Arc (photo)');
  });
});

describe('photos libres : recherche', () => {
  it('prend la photo liée dans OpenStreetMap, avec son crédit', async () => {
    const p = await freePhotoFor({ name: 'Fontaine de la Licorne', lat: 43.6, lng: 3.88, commons: 'File:Fontaine de la Licorne.jpg' });
    expect(p).toEqual({
      url: 'https://upload.wikimedia.org/thumb/File%3AFontaine%20de%20la%20Licorne.jpg',
      credit: { text: 'Photo : Jean D’Arc · CC BY-SA 4.0 · Wikimedia Commons', url: 'https://commons.wikimedia.org/wiki/File%3AFontaine%20de%20la%20Licorne.jpg' },
    });
  });

  it('écarte une licence non libre et passe à la fiche Wikidata', async () => {
    const p = await freePhotoFor({ name: 'Tour', lat: 0, lng: 0, commons: 'File:Tour Eiffel nuit.jpg', wikidata: 'Q1' });
    expect(p?.credit.text).toBe('Photo : auteur inconnu · CC0 · Wikimedia Commons');
  });

  it('à défaut, une photo prise sur place dont le titre reprend le nom du lieu', async () => {
    expect((await freePhotoFor({ name: 'Le Kiosque Bosc', lat: 43.6, lng: 3.88 }))?.credit.text).toBe('Photo : Anonyme · Public domain · Wikimedia Commons');
    expect(await freePhotoFor({ name: 'Le square', lat: 43.6, lng: 3.88 })).toBeNull(); // aucun titre ne correspond
    expect(await freePhotoFor({ name: 'Rien', lat: 0, lng: 0, wikidata: 'pas un identifiant' })).toBeNull();
  });

  it('cherche une photo par lieu du parcours, pas pour le départ', async () => {
    const plan = demoPlan({ lat: 43.6, lng: 3.88 }, 3);
    plan.steps[0].source = 'n0';
    plan.steps[1].source = 'n1';
    plan.steps[2].source = 'n2';
    const pois = [0, 1, 2].map((i) => ({ id: `n${i}`, name: `Lieu ${i}`, kind: 'lieu', lat: 0, lng: 0, details: {}, themed: false, gated: false }));
    const asked: string[] = [];
    const out = await withPhotos(plan, pois, async (p) => {
      asked.push(p.name);
      return p.name === 'Lieu 2' ? null : { url: `https://upload.wikimedia.org/${p.name}`, credit: { text: 'Photo : X · CC0 · Wikimedia Commons', url: null } };
    });
    expect(asked.sort()).toEqual(['Lieu 1', 'Lieu 2']);
    expect(out.steps.map((s) => s.photo?.url ?? null)).toEqual([null, 'https://upload.wikimedia.org/Lieu 1', null, null]);
  });
});

/** Générateur de démonstration dont les lieux ont une photo libre. */
class PhotoGenerator implements HuntGenerator {
  async generate(req: GenerationRequest): Promise<GeneratedHunt> {
    const plan = demoPlan({ lat: 43.6, lng: 3.88 }, 3, 'Montpellier');
    plan.steps.forEach((s, i) => {
      if (i > 0) s.photo = { url: `https://upload.wikimedia.org/photo-${i}.jpg`, credit: { text: `Photo : Auteur ${i} · CC BY 4.0 · Wikimedia Commons`, url: `https://commons.wikimedia.org/wiki/File:${i}.jpg` } };
    });
    return { plan, location: req.location.query ?? 'Montpellier' };
  }
}

describe('photos libres : parcours générés', () => {
  let ctx: Ctx;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const store = new MemoryPhotoStore();
  beforeAll(async () => {
    ctx = await setup();
    app = await buildApp(ctx.pool, { generator: new PhotoGenerator(), photoStore: store, guide: null });
    const image = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#3a7' } }).jpeg().toBuffer();
    // Le téléchargement de Commons est simulé ; la photo 2 échoue.
    app.service.fetchFreePhoto = async (url) => {
      if (url.includes('photo-2')) throw new Error('404');
      return { bytes: image, contentType: 'image/jpeg' };
    };
  });
  afterAll(async () => {
    await app.close();
    await teardown(ctx);
  });

  it('range les photos, les montre à l’arrivée avec leur crédit, et se passe de celles qui échouent', async () => {
    const seb = await loginAs(app, 'seb@example.com');
    const job = await seb.post('/api/hunts/generate', {
      location: { query: 'Montpellier', lat: 43.6, lng: 3.88 },
      durationMinutes: 45,
      travel: 'walk',
      difficulty: 'easy',
      theme: null,
      steps: 3,
      mode: 'organize',
    });
    await app.service.settle();
    const gen = (await seb.get(`/api/generations/${job.body.id}`)).body;
    expect(gen).toMatchObject({ status: 'done', error: null });
    const huntId = gen.huntId;
    const steps = (await seb.get(`/api/hunts/${huntId}/steps`)).body as { order: number; referencePhoto: boolean; photoShow: string | null; photoCredit: unknown }[];
    expect(steps.map((s) => [s.order, s.referencePhoto, s.photoShow])).toEqual([
      [0, false, null],
      [1, true, 'arrival'],
      [2, false, null],
      [3, true, 'arrival'],
    ]);
    expect(steps[1].photoCredit).toEqual({ text: 'Photo : Auteur 1 · CC BY 4.0 · Wikimedia Commons', url: 'https://commons.wikimedia.org/wiki/File:1.jpg' });
    expect([...store.objects.keys()].filter((k) => k.startsWith('refs/gen-'))).toHaveLength(2);
  });
});
