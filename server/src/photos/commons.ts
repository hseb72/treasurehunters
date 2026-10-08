/**
 * Photos libres des lieux d'un parcours généré (§ 47), depuis Wikimedia Commons : la photo
 * liée au lieu dans OpenStreetMap (wikimedia_commons), celle de sa fiche Wikidata (P18), à
 * défaut une photo prise à quelques mètres dont le titre reprend le nom du lieu. Seules les
 * licences libres sont gardées (CC0, CC BY, CC BY-SA, domaine public), avec leur crédit.
 */
import { PhotoCredit } from '../../../shared/models.js';
import { config } from '../config.js';

export interface FreePhoto {
  /** Vignette à télécharger (upload.wikimedia.org). */
  url: string;
  credit: PhotoCredit;
}

export interface PhotoPlace {
  name: string;
  lat: number;
  lng: number;
  /** Tag OSM wikidata (« Q12345 »). */
  wikidata?: string;
  /** Tag OSM wikimedia_commons (« File:Fontaine.jpg »). */
  commons?: string;
}

const TIMEOUT_MS = 8_000;
const THUMB_WIDTH = 1280;
/** Rayon de recherche d'une photo prise sur place, quand le lieu n'en a pas d'attitrée. */
const NEAR_M = 60;

async function api(base: string, params: Record<string, string>): Promise<unknown> {
  const url = `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': config.osmUserAgent }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(base).host} a répondu ${res.status}`);
  return res.json();
}

/** Licence libre et réutilisable avec crédit ; pas les images « fair use » ni les licences NC/ND. */
export function freeLicense(meta: Record<string, { value?: string } | undefined>): string | null {
  if (meta['NonFree']?.value === 'true') return null;
  const code = (meta['License']?.value ?? '').toLowerCase();
  const short = (meta['LicenseShortName']?.value ?? '').trim();
  const ok = /^(cc0|cc-by(-sa)?(-\d(\.\d)?)?([-a-z]*)?|pd|pd-.*|public[ -]?domain)$/.test(code) || /^(cc0|cc by(-sa)? \d(\.\d)?|public domain)\b/i.test(short);
  if (!ok || /-nc|-nd|\bnc\b|\bnd\b/i.test(code + ' ' + short)) return null;
  return short || code.toUpperCase();
}

/** Texte brut d'un champ HTML de Commons (« <a href=…>Jean Dupont</a> »). */
export function plainText(html: string | undefined): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, '’')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mots significatifs d'un nom, sans accents : « Fontaine de la Licorne » → fontaine, licorne. */
function words(s: string): Set<string> {
  const STOP = new Set(['avec', 'dans', 'pour', 'sous', 'vers', 'file', 'jpeg', 'view', 'from']);
  return new Set(
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

async function fileFromWikidata(id: string): Promise<string | null> {
  if (!/^Q\d{1,12}$/.test(id)) return null;
  const data = (await api(config.wikidataApiUrl, { action: 'wbgetclaims', entity: id, property: 'P18' })) as {
    claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] };
  };
  const name = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return name ? `File:${name}` : null;
}

async function fileNearby(place: PhotoPlace): Promise<string | null> {
  const data = (await api(config.commonsApiUrl, {
    action: 'query',
    list: 'geosearch',
    gscoord: `${place.lat}|${place.lng}`,
    gsradius: String(NEAR_M),
    gsnamespace: '6',
    gslimit: '20',
  })) as { query?: { geosearch?: { title: string }[] } };
  const wanted = words(place.name);
  if (!wanted.size) return null;
  // Une photo prise là ne suffit pas : son titre doit reprendre le nom du lieu.
  return data.query?.geosearch?.find((g) => [...words(g.title)].some((w) => wanted.has(w)))?.title ?? null;
}

/** Vignette et crédit d'un fichier Commons, s'il est sous licence libre. */
export async function describeFile(title: string): Promise<FreePhoto | null> {
  const data = (await api(config.commonsApiUrl, {
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: String(THUMB_WIDTH),
  })) as {
    query?: {
      pages?: {
        imageinfo?: { thumburl?: string; url?: string; descriptionurl?: string; mime?: string; extmetadata?: Record<string, { value?: string }> }[];
      }[];
    };
  };
  const info = data.query?.pages?.[0]?.imageinfo?.[0];
  if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) return null;
  const meta = info.extmetadata ?? {};
  const license = freeLicense(meta);
  const url = info.thumburl ?? info.url;
  if (!license || !url) return null;
  const artist = plainText(meta['Artist']?.value).slice(0, 80) || 'auteur inconnu';
  const page = info.descriptionurl && /^https:\/\/commons\.wikimedia\.org\//.test(info.descriptionurl) ? info.descriptionurl : null;
  return { url, credit: { text: `Photo : ${artist} · ${license} · Wikimedia Commons`.slice(0, 300), url: page } };
}

/** Photo libre d'un lieu, ou null (aucune, licence non libre, service injoignable). */
export async function freePhotoFor(place: PhotoPlace): Promise<FreePhoto | null> {
  const tag = place.commons?.trim();
  const candidates: (() => Promise<string | null>)[] = [
    async () => (tag && /^File:/i.test(tag) ? tag : null),
    async () => (place.wikidata ? fileFromWikidata(place.wikidata.trim()) : null),
    () => fileNearby(place),
  ];
  for (const candidate of candidates) {
    try {
      const title = await candidate();
      const photo = title ? await describeFile(title) : null;
      if (photo) return photo;
    } catch {
      // Source suivante.
    }
  }
  return null;
}
