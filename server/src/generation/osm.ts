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

const TIMEOUT_MS = 30_000;
const DETAIL_TAGS = ['description', 'inscription', 'start_date', 'artist_name', 'architect', 'subject', 'memorial', 'material', 'denomination', 'wikipedia', 'addr:street'];
const KIND_TAGS = ['historic', 'tourism', 'amenity', 'man_made', 'leisure', 'artwork_type', 'memorial'];

const unavailable = (cause: unknown) =>
  new HttpError(502, 'La carte OpenStreetMap ne répond pas pour le moment, réessayez dans un instant.', cause);

async function osmFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': config.osmUserAgent, 'Accept-Language': 'fr', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw unavailable(new Error(`${new URL(url).host} injoignable : ${(e as Error).message}`, { cause: e }));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw unavailable(new Error(`${new URL(url).host} a répondu ${res.status} : ${body.slice(0, 300)}`));
  }
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    // Page HTML de blocage ou de surcharge servie avec un statut 200.
    throw unavailable(new Error(`${new URL(url).host} a répondu autre chose que du JSON : ${body.slice(0, 300)}`));
  }
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
  const around = `(around:${Math.round(radius)},${center.lat},${center.lng})`;
  const query = `[out:json][timeout:25];
(
  nwr${around}[historic][name];
  nwr${around}[tourism~"^(artwork|viewpoint|attraction|museum)$"][name];
  nwr${around}[amenity~"^(fountain|place_of_worship|clock|library|theatre)$"][name];
  nwr${around}[man_made~"^(tower|lighthouse|obelisk|water_tower)$"][name];
  nwr${around}[leisure~"^(park|garden)$"][name];
);
out center tags 300;`;
  const data = (await osmFetch(config.overpassUrl, {
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
  return pois.sort((a, b) => distanceMeters(center, a) - distanceMeters(center, b));
}
