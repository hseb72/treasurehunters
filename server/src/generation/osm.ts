/**
 * Lieux réels autour d'un point, depuis OpenStreetMap (§ 11.2) :
 * Nominatim pour le géocodage, Overpass pour les lieux remarquables.
 */
import { distanceMeters } from '../../../shared/rules.js';
import { config } from '../config.js';
import { describeError, HttpError } from '../errors.js';

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
  /** Correspond au thème demandé par le joueur. */
  themed: boolean;
  /**
   * Lieu clos ou soumis à des horaires (parc, musée, église…) : on doit pouvoir valider
   * l'étape depuis son entrée, même fermé.
   */
  gated: boolean;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Où valider une étape sur un lieu clos : ses entrées, à défaut des points de son contour. */
export interface Access {
  points: LatLng[];
  /** true : entrées cartographiées ; false : points du contour. */
  entrances: boolean;
}

/**
 * Catégorie OpenStreetMap tirée d'un thème libre : une clé (shop, leisure…) et ses valeurs
 * (null = toute valeur). Validée avant d'entrer dans la requête Overpass.
 */
export interface ThemeFilter {
  key: string;
  values: string[] | null;
}

/** Clés OpenStreetMap qu'un thème peut viser. */
export const THEME_KEYS = [
  'amenity', 'shop', 'leisure', 'tourism', 'historic', 'man_made', 'natural', 'craft', 'sport',
  'building', 'landuse', 'highway', 'route', 'waterway', 'heritage', 'memorial', 'artwork_type', 'cuisine',
] as const;
const THEME_VALUE = /^[a-z0-9_:-]{1,40}$/;

/** Ne garde que des filtres sûrs : clés connues, valeurs simples (rien qui s'échappe de la requête). */
export function safeThemeFilters(filters: ThemeFilter[]): ThemeFilter[] {
  return filters
    .filter((f) => (THEME_KEYS as readonly string[]).includes(f.key))
    .map((f) => ({ key: f.key, values: f.values === null ? null : f.values.filter((v) => THEME_VALUE.test(v)).slice(0, 10) }))
    .filter((f) => f.values === null || f.values.length > 0)
    .slice(0, 6);
}

function themeClause(f: ThemeFilter): string {
  return f.values === null ? `nw[${f.key}][name]` : `nw[${f.key}~"^(${f.values.join('|')})$"][name]`;
}

function matchesTheme(tags: Record<string, string>, filters: ThemeFilter[]): boolean {
  return filters.some((f) => tags[f.key] !== undefined && (f.values === null || f.values.includes(tags[f.key])));
}

export interface Place {
  lat: number;
  lng: number;
  name: string;
}

/** Au-delà du `timeout` de la requête Overpass (20 s), pour recevoir sa réponse d'erreur. */
const TIMEOUT_MS = 35_000;
const DETAIL_TAGS = ['description', 'inscription', 'start_date', 'artist_name', 'architect', 'subject', 'memorial', 'material', 'denomination', 'wikipedia', 'addr:street'];
const KIND_TAGS = ['historic', 'tourism', 'amenity', 'shop', 'man_made', 'leisure', 'natural', 'craft', 'sport', 'artwork_type', 'memorial'];

/** Lieux qu'on visite à l'intérieur, souvent fermés la nuit, le dimanche ou hors saison. */
const GATED: Record<string, RegExp> = {
  tourism: /^(museum|gallery|zoo|aquarium|theme_park|attraction)$/,
  amenity: /^(place_of_worship|library|theatre|arts_centre|cinema|townhall|university|school|marketplace)$/,
  leisure: /^(park|garden|nature_reserve|stadium|sports_centre|playground)$/,
  historic: /^(castle|fort|monastery|church|manor|palace|citywalls|archaeological_site)$/,
  landuse: /^(cemetery)$/,
  building: /^(church|cathedral|chapel|museum|castle|train_station)$/,
};

function isGated(type: string, tags: Record<string, string>): boolean {
  if (type !== 'node' && type !== 'way') return false;
  // Une boutique se trouve depuis sa vitrine, sur le trottoir : son point suffit.
  if (tags['shop']) return false;
  if (tags['opening_hours']) return true;
  return Object.entries(GATED).some(([key, re]) => tags[key] !== undefined && re.test(tags[key]));
}

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
/** Début lisible d'une réponse : les pages d'erreur Overpass sont en HTML. */
const excerpt = (body: string, n: number) => body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
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
    throw new Transient(`${host} injoignable : ${describeError(e)}`);
  }
  const body = await res.text().catch(() => '');
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new Transient(`${host} a répondu ${res.status} : ${excerpt(body, 200)}`, retryAfter > 0 ? retryAfter * 1000 : null);
  }
  if (!res.ok) throw unavailable(new Error(`${host} a répondu ${res.status} : ${excerpt(body, 300)}`));
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    // Page HTML de blocage ou de surcharge servie avec un statut 200.
    throw new Transient(`${host} a répondu autre chose que du JSON : ${excerpt(body, 200)}`);
  }
  // Overpass surchargé répond 200 avec une remarque « runtime error » et une liste vide.
  const remark = (data as { remark?: string }).remark;
  if (remark && /runtime error|timed out|out of memory/i.test(remark)) throw new Transient(`${host} : ${remark.slice(0, 200)}`);
  return data;
}

/**
 * Appel à un service OpenStreetMap public, avec reprises : les instances publiques limitent
 * le débit et saturent souvent. Chaque essai passe à l'adresse suivante (miroirs), en boucle :
 * chaque miroir est essayé au moins une fois, et il y a au moins trois essais en tout.
 */
async function osmFetch(urls: string | string[], init: RequestInit = {}): Promise<unknown> {
  const list = Array.isArray(urls) ? urls : [urls];
  const attempts = Math.max(BACKOFF_MS.length + 1, list.length);
  const failures: string[] = [];
  let pauses = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetchJson(list[attempt % list.length], init);
    } catch (e) {
      if (!(e instanceof Transient)) throw e;
      failures.push(e.message);
      if (attempt + 1 === attempts) break;
      // Un miroir pas encore essayé n'a pas de raison d'attendre ; on ne patiente qu'avant d'y revenir.
      if (attempt + 1 < list.length) continue;
      await sleep(Math.min(e.retryAfterMs ?? BACKOFF_MS[Math.min(pauses++, BACKOFF_MS.length - 1)], 20_000));
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

/** Au-delà de ce rayon, la zone est trop vaste pour tout ramener : seulement les lieux marquants. */
export const PROMINENT_FROM = 4000;

/** Boîte englobante d'un cercle, au format Overpass (sud, ouest, nord, est). */
function bboxAround(center: { lat: number; lng: number }, radius: number): string {
  const dLat = radius / 111_195;
  const dLng = radius / (111_195 * Math.cos((center.lat * Math.PI) / 180));
  return [center.lat - dLat, center.lng - dLng, center.lat + dLat, center.lng + dLng].map((x) => x.toFixed(6)).join(',');
}

/**
 * Catégories de lieux recherchées. `nw` et non `nwr` : les relations (grands parcs
 * multipolygones) coûtent cher à calculer et font rarement de bonnes étapes. Sur une grande
 * zone, seulement les lieux marquants.
 */
function placeClauses(prominent: boolean): string {
  return prominent
    ? `  nw[historic][name][wikidata];
  nw[tourism~"^(viewpoint|attraction|museum)$"][name];
  nw[amenity~"^(place_of_worship|theatre)$"][name][wikidata];
  nw[man_made~"^(tower|lighthouse|obelisk|water_tower)$"][name];
  nw[leisure~"^(park|garden)$"][name][wikidata];`
    : `  nw[historic][name];
  nw[tourism~"^(artwork|viewpoint|attraction|museum)$"][name];
  nw[amenity~"^(fountain|place_of_worship|clock|library|theatre)$"][name];
  nw[man_made~"^(tower|lighthouse|obelisk|water_tower)$"][name];
  nw[leisure~"^(park|garden)$"][name];`;
}

/**
 * Nombre de lieux remarquables dans un carré autour du point (§ 11.2), sans les rapatrier :
 * `out count` ne renvoie qu'un total, la requête reste légère même en zone très dense. Sert
 * à mesurer la densité avant d'interroger une grande zone.
 */
export async function countPlacesAround(center: { lat: number; lng: number }, radius: number, prominent: boolean): Promise<number> {
  const query = `[out:json][timeout:15][bbox:${bboxAround(center, radius)}];
(
${placeClauses(prominent)}
);
out count;`;
  const data = (await osmFetch(config.overpassUrls, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })) as { elements?: { type: string; tags?: Record<string, string> }[] };
  const total = Number(data.elements?.find((e) => e.type === 'count')?.tags?.['total']);
  if (!Number.isFinite(total)) throw unavailable(new Error('Overpass : comptage sans total'));
  return total;
}

/**
 * Rayon qui contiendrait environ `target` lieux, d'après le nombre compté dans un carré de
 * demi-côté `probeRadius` : le nombre de lieux croît comme la surface, donc comme le carré
 * du rayon. Aucun lieu compté : rayon infini (l'appelant plafonne).
 */
export function radiusForDensity(counted: number, probeRadius: number, target: number): number {
  return counted <= 0 ? Number.POSITIVE_INFINITY : Math.round(probeRadius * Math.sqrt(target / counted));
}

/**
 * Lieux remarquables et nommés dans un rayon donné, du plus proche au plus lointain, plus ceux
 * du thème demandé. Sur une grande zone (expédition motorisée), on ne garde que les lieux
 * marquants (référencés dans Wikidata, points de vue, musées, phares…) : une ville entière de
 * statues et de parcs dépasserait ce qu'Overpass accepte et ce que l'IA peut lire.
 */
export async function placesAround(
  center: { lat: number; lng: number },
  radius: number,
  theme: ThemeFilter[] = [],
): Promise<Poi[]> {
  // Zone de recherche en boîte englobante (`bbox`) : indexée, donc rapide. Un filtre
  // `around` combiné à des clés comme [historic] fait parcourir bien trop d'objets et
  // les instances publiques abandonnent (504). Le cercle exact est appliqué ensuite.
  const bbox = bboxAround(center, radius);
  // `maxsize` à 128 Mio au lieu de 512 : Overpass admet une requête selon les ressources
  // qu'elle annonce, et un serveur chargé refuse (504) celles qui en demandent beaucoup.
  const base = placeClauses(radius > PROMINENT_FROM);
  const filters = safeThemeFilters(theme);
  // Deux jeux de résultats : les lieux du thème ne doivent pas être évincés par la limite.
  const themed = filters.length ? `(\n${filters.map((f) => `  ${themeClause(f)};`).join('\n')}\n)->.theme;\n.theme out center tags 200;\n` : '';
  const query = `[out:json][timeout:25][maxsize:134217728][bbox:${bbox}];
${themed}(
${base}
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
    pois.push({ id: `${e.type[0]}${e.id}`, name, kind, lat, lng, details, themed: matchesTheme(tags, filters), gated: isGated(e.type, tags) });
  }
  return pois.filter((p) => distanceMeters(center, p) <= radius).sort((a, b) => distanceMeters(center, a) - distanceMeters(center, b));
}

/** Au-delà, un lieu est assez vaste pour qu'on ne puisse pas le valider depuis son centre. */
const SMALL_PLACE_M = 30;
/** Écart minimal entre deux points de contour gardés, et nombre maximal de points par lieu. */
const OUTLINE_STEP_M = 50;
const MAX_ACCESS_POINTS = 30;
/** Distance maximale d'un portail au contour du lieu. */
const GATE_NEAR_M = 15;
/** Portes et portails par lesquels on entre ; pas les issues de secours ni les accès privés. */
const GATE_BARRIERS = 'gate|entrance|turnstile|kissing_gate|lift_gate|swing_gate|full-height_turnstile';

type OsmShape = { type: 'way'; id: number; nodes?: number[]; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string> };
type OsmNode = { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> };

/**
 * Entrées des lieux clos choisis pour le parcours (§ 11.2) : un parc, un musée ou une église
 * se valide depuis ses entrées, pour qu'une chasse jouée pendant la fermeture reste jouable.
 * Pour un lieu cartographié en surface (way), on prend les nœuds `entrance` ou portails de son
 * contour ; pour un lieu ponctuel, ceux du bâtiment qui le contient. Sans entrée connue, des
 * points répartis sur le contour : être au bord du lieu, c'est y être. Un lieu petit ou sans
 * contour garde son point. Une seule requête Overpass pour tous les lieux.
 */
export async function accessOf(pois: Poi[]): Promise<Map<string, Access>> {
  const ways = pois.filter((p) => p.id.startsWith('w')).map((p) => p.id.slice(1));
  const nodes = pois.filter((p) => p.id.startsWith('n')).map((p) => p.id.slice(1));
  const result = new Map<string, Access>();
  if (!ways.length && !nodes.length) return result;
  const sets = [
    ...(ways.length ? [`way(id:${ways.join(',')})->.a;`] : []),
    // Lieu ponctuel : les bâtiments autour, dont on garde ensuite celui qui le contient.
    ...(nodes.length ? [`node(id:${nodes.join(',')})->.p;`, 'way(around.p:30)[building]->.b;'] : []),
  ];
  const query = `[out:json][timeout:25];
${sets.join('\n')}
(${ways.length ? '.a; ' : ''}${nodes.length ? '.b;' : ''})->.shapes;
.shapes out body geom;
(
  node(w.shapes)[entrance][entrance!~"^(emergency|exit|service)$"][access!~"^(private|no)$"];
  node(around.shapes:${GATE_NEAR_M})[barrier~"^(${GATE_BARRIERS})$"][access!~"^(private|no)$"];
);
out;`;
  const data = (await osmFetch(config.overpassUrls, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })) as { elements: (OsmShape | OsmNode)[] };

  const shapes = new Map<number, OsmShape>();
  const doors: (LatLng & { id: number; gate: boolean })[] = [];
  for (const e of data.elements ?? []) {
    if (e.type === 'way' && e.geometry?.length) shapes.set(e.id, e);
    if (e.type === 'node') doors.push({ id: e.id, lat: e.lat, lng: e.lon, gate: !!e.tags?.['barrier'] });
  }
  for (const poi of pois) {
    const shape = poi.id.startsWith('w') ? shapes.get(Number(poi.id.slice(1))) : containingShape(poi, shapes.values());
    if (!shape?.geometry) continue;
    const outline = shape.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
    if (Math.max(...outline.map((p) => distanceMeters(poi, p))) <= SMALL_PLACE_M) continue;
    // Une entrée posée sur le contour, ou un portail tout près (sur la clôture ou le chemin
    // qui la traverse) ; pas les portes des bâtiments voisins.
    const onOutline = new Set(shape.nodes ?? []);
    const entrances = doors
      .filter((d) => onOutline.has(d.id) || (d.gate && distanceToOutline(d, outline) <= GATE_NEAR_M))
      .map(({ lat, lng }) => ({ lat, lng }));
    result.set(poi.id, entrances.length ? { points: spread(entrances, 10), entrances: true } : { points: spread(outline, OUTLINE_STEP_M), entrances: false });
  }
  return result;
}

/** Bâtiment dont le contour contient le point (un musée cartographié par un simple nœud). */
function containingShape(p: LatLng, shapes: Iterable<OsmShape>): OsmShape | undefined {
  for (const s of shapes) {
    if (!s.tags?.['building']) continue; // pas le parc où se trouve le musée
    const ring = s.geometry ?? [];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.lon > p.lng !== b.lon > p.lng && p.lat < ((b.lat - a.lat) * (p.lng - a.lon)) / (b.lon - a.lon) + a.lat) inside = !inside;
    }
    if (inside) return s;
  }
  return undefined;
}

/** Distance d'un point au contour (segments), en mètres ; projection locale, suffisante à cette échelle. */
function distanceToOutline(p: LatLng, outline: LatLng[]): number {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  let best = Infinity;
  for (let i = 1; i < outline.length; i++) {
    const ax = (outline[i - 1].lng - p.lng) * kx;
    const ay = (outline[i - 1].lat - p.lat) * ky;
    const bx = (outline[i].lng - p.lng) * kx;
    const by = (outline[i].lat - p.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Points espacés d'au moins `gap` mètres, au plus MAX_ACCESS_POINTS. */
function spread(points: LatLng[], gap: number): LatLng[] {
  const kept: LatLng[] = [];
  for (const p of points) {
    if (kept.every((k) => distanceMeters(k, p) >= gap)) kept.push(p);
    if (kept.length === MAX_ACCESS_POINTS) break;
  }
  return kept;
}
