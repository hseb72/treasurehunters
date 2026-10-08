/**
 * Images venues de l'extérieur (§ 47) : lien collé par un organisateur, photo libre de
 * Wikimedia Commons, ou fichier envoyé. Rien n'est montré tel quel aux joueurs :
 *
 * - le lien est téléchargé par le serveur, jamais affiché : pas de page publicitaire ni
 *   d'hameçonnage à portée de clic, pas d'adresse des joueurs envoyée à un tiers ;
 * - le téléchargement refuse les adresses internes (SSRF), les raccourcisseurs et les régies,
 *   suit au plus trois redirections, chacune revérifiée, et s'arrête au-delà de 8 Mo ;
 * - l'image est décodée puis **réencodée** en JPEG : un fichier piégé (polyglotte, charge
 *   cachée après l'image) ne survit pas, et les métadonnées (position GPS de l'appareil,
 *   auteur, logiciel) disparaissent.
 */
import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { request, RequestOptions } from 'node:https';
import { BlockList, isIP, LookupFunction } from 'node:net';
import sharp from 'sharp';
import { config } from '../config.js';
import { badRequest, HttpError } from '../errors.js';
import { StoredPhoto } from './store.js';

/** Taille maximale téléchargée, et côté maximal de l'image gardée. */
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const MAX_SIDE = 1600;
/** Au-delà, une image minuscule (pixel espion) ou démesurée (bombe de décompression). */
const MIN_SIDE = 64;
const MAX_PIXELS = 50_000_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

/** Formats d'image acceptés en entrée ; jamais de SVG (du code peut s'y cacher). */
const FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif']);

/** Adresses non publiques : réseau interne, boucle locale, métadonnées du cloud, réservées. */
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv4');
}
// Pas de règle ::ffff:0:0/96 : BlockList l'appliquerait à toutes les IPv4 ; les IPv4 écrites en
// IPv6 sont ramenées à l'IPv4 dans isPrivateAddress.
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return PRIVATE.check(address, 'ipv4');
  if (family === 6) {
    // IPv4 écrite en IPv6 (::ffff:10.0.0.1) : on vérifie l'IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    return mapped ? PRIVATE.check(mapped[1], 'ipv4') : PRIVATE.check(address, 'ipv6');
  }
  return true;
}

/**
 * Domaines refusés : raccourcisseurs (on ne sait pas où ils mènent) et régies publicitaires
 * ou de pistage. Le domaine et tous ses sous-domaines.
 */
const BLOCKED_DOMAINS = [
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 'lnkd.in',
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'adnxs.com', 'taboola.com', 'outbrain.com',
  'criteo.com', 'criteo.net', 'amazon-adsystem.com', 'adsrvr.org', 'pubmatic.com', 'rubiconproject.com', 'openx.net', 'smartadserver.com',
  'moatads.com', 'scorecardresearch.com', 'zedo.com', 'popads.net', 'propellerads.com', 'adform.net', 'media.net',
];

export function blockedDomain(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return BLOCKED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Lien utilisable : HTTPS, port standard, nom de domaine (pas d'adresse IP), sans identifiants. */
export function checkImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw badRequest('Ce lien n’est pas une adresse web valide.');
  }
  if (url.protocol !== 'https:') throw badRequest('Seuls les liens sécurisés (https://) sont acceptés.');
  if (url.username || url.password) throw badRequest('Ce lien contient des identifiants : il est refusé.');
  if (url.port && url.port !== '443') throw badRequest('Ce lien utilise un port inhabituel : il est refusé.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) throw badRequest('Donnez le lien d’un site (nom de domaine), pas une adresse IP.');
  if (!host.includes('.') || /\.(local|internal|lan|home|corp|localhost)$/i.test(host)) throw badRequest('Ce lien ne mène pas à un site public.');
  if (blockedDomain(host)) throw badRequest('Les liens raccourcis et publicitaires sont refusés : collez le lien direct de la photo.');
  return url;
}

/** Résolution DNS qui refuse toute adresse non publique, au moment même de la connexion. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as (e: Error | null, a: string, f: number) => void)(err, '', 0);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (!list.length || bad) {
      return (callback as (e: Error | null, a: string, f: number) => void)(new Error(`adresse non publique (${bad?.address ?? 'aucune'})`), '', 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    return (callback as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
  });
};

/** Lien signalé par Google Safe Browsing (si une clé est configurée) : hameçonnage, logiciel malveillant… */
async function flaggedBySafeBrowsing(url: string): Promise<boolean> {
  const key = config.safeBrowsingKey;
  if (!key) return false;
  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'secrettracks', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { matches?: unknown[] };
    return !!data.matches?.length;
  } catch {
    // Service injoignable : les autres contrôles restent en place.
    return false;
  }
}

/** Options de connexion : surchargées par les tests (serveur local de confiance). */
export const fetchOptions: { lookup: LookupFunction; extra: RequestOptions } = { lookup: publicLookup, extra: {} };

function download(url: URL): Promise<{ status: number; location: string | null; type: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        lookup: fetchOptions.lookup,
        agent: false,
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': config.osmUserAgent, Accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8' },
        ...fetchOptions.extra,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location ?? null, type: '', bytes: Buffer.alloc(0) });
        }
        const length = Number(res.headers['content-length'] ?? 0);
        if (length > MAX_DOWNLOAD_BYTES) {
          res.destroy();
          return reject(badRequest('Cette photo est trop lourde (8 Mo au plus).'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_DOWNLOAD_BYTES) {
            res.destroy();
            reject(badRequest('Cette photo est trop lourde (8 Mo au plus).'));
          } else chunks.push(c);
        });
        res.on('end', () => resolve({ status, location: null, type: String(res.headers['content-type'] ?? ''), bytes: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Télécharge une image depuis un lien, avec tous les contrôles ci-dessus, et la rend
 * réencodée. `trusted` : source connue (Wikimedia), sans vérification Safe Browsing.
 */
export async function fetchImage(raw: string, trusted = false): Promise<StoredPhoto & { finalUrl: string }> {
  let url = checkImageUrl(raw);
  if (!trusted && (await flaggedBySafeBrowsing(url.href))) throw badRequest('Ce lien est signalé comme dangereux : il est refusé.');
  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await download(url);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, 'Impossible de récupérer cette photo : vérifiez le lien (il doit mener directement à l’image).', e);
    }
    if (res.location) {
      if (hop >= MAX_REDIRECTS) throw badRequest('Ce lien redirige trop de fois : collez le lien direct de la photo.');
      url = checkImageUrl(new URL(res.location, url).href);
      continue;
    }
    if (res.status !== 200) throw new HttpError(422, `Le site de la photo a répondu ${res.status} : vérifiez le lien.`);
    if (!/^image\//i.test(res.type)) throw badRequest('Ce lien mène à une page, pas à une image : ouvrez la photo seule et copiez son adresse.');
    return { ...(await sanitizeImage(res.bytes)), finalUrl: url.href };
  }
}

/**
 * Décode l'image et la réencode en JPEG (rotation EXIF appliquée, côté maximal 1600 px) :
 * seuls les pixels sont gardés. Refuse ce qui n'est pas une vraie photo dans un format courant.
 */
export async function sanitizeImage(bytes: Buffer): Promise<StoredPhoto> {
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false });
    const meta = await image.metadata();
    if (!meta.format || !FORMATS.has(meta.format)) throw badRequest('Format d’image non accepté : JPEG, PNG, WebP, GIF, AVIF ou HEIC.');
    if ((meta.width ?? 0) < MIN_SIDE || (meta.height ?? 0) < MIN_SIDE) throw badRequest('Cette image est trop petite pour illustrer une étape.');
    const out = await image
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { bytes: out, contentType: 'image/jpeg' };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw badRequest('Ce fichier n’est pas une image lisible.');
  }
}
