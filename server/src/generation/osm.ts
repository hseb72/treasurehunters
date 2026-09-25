/**
 * Lieux réels autour d'un point, depuis OpenStreetMap (§ 11.2) :
 * Nominatim pour le géocodage, Overpass pour les lieux remarquables.
 */
import { distanceMeters } from '../../../shared/rules.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

export interface Poi {
  /** Identifiant OSM, par exemple « n123456 » ou « w42 ». */
  id: string;
  name: string;
  /** Nature du lieu (fontaine, statue, église…), tirée des tags OSM. */
  kind: string;
  lat: number;
  lng: number;
  /** Tags utiles pour inventer une énigme (inscription, date, artiste…). */
  details: Record<string, string>;
}

export interface Place {
  lat: number;
  lng: number;
  name: string;
}

/** Au-delà du `timeout` de la requête Overpass (20 s), pour recevoir sa réponse d'erreur. */
const TIMEOUT_MS = 35_000;
const DETAIL_TAGS = ['description', 'inscription', 'start_date', 'artist_name', 'architect', 'subject', 'memorial', 'material', 'denomination', 'wikipedia', 'addr:street'];
const KIND_TAGS = ['historic', 'tourism', 'amenity', 'man_made', 'leisure', 'artwork_type', 'memorial'];

const unavailable = (cause: unknown) =>
  new HttpError(502, 'La carte OpenStreetMap ne répond pas pour le moment, réessayez dans un instant.', cause);

/** Échec passager (surcharge, limite de débit, coupure) : on peut réessayer, ailleurs ou plus tard. */
class Transient extends Error {
  constructor(
    message: string,
    /** Délai demandé par le serveur (en-tête Retry-After), en millisecondes. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pauses entre deux essais ; Retry-After est respecté dans la limite de 20 s. */
const BACKOFF_MS = [2_000, 6_000];

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': config.osmUserAgent, 'Accept-Language': 'fr', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Transient(`${host} injoignable : ${(e as Error).message}`);
  }
  const body = await res.text().catch(() => '');
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new Transient(`${host} a répondu ${res.status} : ${body.slice(0, 200)}`, retryAfter > 0 ? retryAfter * 1000 : null);
  }
  if (!res.ok) throw unavailable(new Error(`${host} a répondu ${res.status} : ${body.slice(0, 300)}`));
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    // Page HTML de blocage ou de surcharge servie avec un statut 200.
    throw new Transient(`${host} a répondu autre chose que du JSON : ${body.slice(0, 200)}`);
  }
  // Overpass surchargé répond 200 avec une remarque « runtime error » et une liste vide.
  const remark = (data as { remark?: string }).remark;
  if (remark && /runtime error|timed out|out of memory/i.test(remark)) throw new Transient(`${host} : ${remark.slice(0, 200)}`);
  return data;
}

/**
 * Appel à un service OpenStreetMap public, avec reprises : les instances publiques limitent
 * le débit et saturent souvent. Chaque essai passe à l'adresse suivante (miroirs), en boucle.
 */
async function osmFetch(urls: string | string[], init: RequestInit = {}): Promise<unknown> {
  const list = Array.isArray(urls) ? urls : [urls];
  const failures: string[] = [];
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      return await fetchJson(list[attempt % list.length], init);
    } catch (e) {
      if (!(e instanceof Transient)) throw e;
      failures.push(e.message);
      if (attempt < BACKOFF_MS.length) await sleep(Math.min(e.retryAfterMs ?? BACKOFF_MS[attempt], 20_000));
    }
  }
  throw unavailable(new Error(failures.join(' | ')));
}

/** Nom de ville ou adresse → coordonnées. */
export async function geocode(query: string): Promise<Place> {
  const url = `${config.nominatimUrl}/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const [hit] = (await osmFetch(url)) as { lat: string; lon: string; name?: string; display_name: string }[];
  if (!hit) throw new HttpError(422, `Lieu introuvable : « ${query} ». Essayez un nom de ville ou une adresse.`);
  return { lat: Number(hit.lat), lng: Number(hit.lon), name: hit.name || hit.display_name.split(',')[0] };
}

/** Coordonnées → nom du quartier ou de la ville (pour nommer la chasse). */
export async function reverseGeocode(lat: number, lng: number): Promise<Place> {
  try {
    const url = `${config.nominatimUrl}/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lng}`;
    const r = (await osmFetch(url)) as { address?: Record<string, string>; name?: string };
    const a = r.address ?? {};
    const name = a['suburb'] ?? a['village'] ?? a['town'] ?? a['city'] ?? r.name ?? 'les environs';
    return { lat, lng, name };
  } catch {
    return { lat, lng, name: 'les environs' }; // le nom n'est qu'un habillage
  }
}

/** Lieux remarquables et nommés dans un rayon donné, du plus proche au plus lointain. */
export async function placesAround(center: { lat: number; lng: number }, radius: number): Promise<Poi[]> {
  // Zone de recherche en boîte englobante (`bbox`) : indexée, donc rapide. Un filtre
  // `around` combiné à des clés comme [historic] fait parcourir bien trop d'objets et
  // les instances publiques abandonnent (504). Le cercle exact est appliqué ensuite.
  const dLat = radius / 111_195;
  const dLng = radius / (111_195 * Math.cos((center.lat * Math.PI) / 180));
  const f = (x: number) => x.toFixed(6);
  const bbox = [center.lat - dLat, center.lng - dLng, center.lat + dLat, center.lng + dLng].map(f).join(',');
  // `nw` et non `nwr` : les relations (grands parcs multipolygones) coûtent cher à
  // calculer et font rarement de bonnes étapes.
  const query = `[out:json][timeout:20][bbox:${bbox}];
(
  nw[historic][name];
  nw[tourism~"^(artwork|viewpoint|attraction|museum)$"][name];
  nw[amenity~"^(fountain|place_of_worship|clock|library|theatre)$"][name];
  nw[man_made~"^(tower|lighthouse|obelisk|water_tower)$"][name];
  nw[leisure~"^(park|garden)$"][name];
);
out center tags 500;`;
  const data = (await osmFetch(config.overpassUrls, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })) as { elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };

  const seen = new Set<string>();
  const pois: Poi[] = [];
  for (const e of data.elements ?? []) {
    const tags = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const name = tags['name']?.trim();
    if (lat === undefined || lng === undefined || !name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // une statue et son socle, une église et son clocher…
    seen.add(key);
    const kind = KIND_TAGS.filter((t) => tags[t] && tags[t] !== 'yes').map((t) => tags[t]).join(', ') || 'lieu';
    const details = Object.fromEntries(DETAIL_TAGS.filter((t) => tags[t]).map((t) => [t, tags[t].slice(0, 300)]));
    pois.push({ id: `${e.type[0]}${e.id}`, name, kind, lat, lng, details });
  }
  return pois.filter((p) => distanceMeters(center, p) <= radius).sort((a, b) => distanceMeters(center, a) - distanceMeters(center, b));
}
