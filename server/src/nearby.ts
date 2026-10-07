/**
 * « Autour de moi » (§ 45) : adresses utiles près du joueur, depuis OpenStreetMap. Une seule
 * requête Overpass par ouverture du volet, gardée en cache : les équipes d'une même chasse
 * passent aux mêmes endroits, et les instances publiques d'Overpass limitent le débit.
 */
import { NEARBY_CATEGORIES, NEARBY_PER_CATEGORY, NearbyBuiltin, NearbyCategory, nearbyKind, NearbyPlace, NearbyResult, hoursLabel } from '../../shared/nearby.js';
import { distanceMeters } from '../../shared/rules.js';
import { config } from './config.js';
import { bboxAround, osmFetch, safeThemeFilters, ThemeFilter } from './generation/osm.js';

/** Centre d'intérêt de l'équipe (« Sneakers ») et les catégories OpenStreetMap qui y répondent. */
export interface Interest {
  label: string;
  filters: ThemeFilter[];
}

export interface NearbyFinder {
  find(center: { lat: number; lng: number }, radius: number, interests?: Interest[]): Promise<NearbyResult>;
}

/** Clauses Overpass de chaque catégorie fixe ; sans exigence de nom là où les lieux n'en ont pas. */
const CLAUSES: Record<NearbyBuiltin, string[]> = {
  snack: ['nw[amenity~"^(cafe|ice_cream)$"][name]', 'nw[shop~"^(bakery|pastry|confectionery|chocolate)$"][name]'],
  food: ['nw[amenity~"^(restaurant|fast_food|biergarten)$"][name]'],
  shops: ['nw[shop][name]'],
  toilets: ['nw[amenity=toilets][access!~"^(private|no|customers)$"]'],
  pharmacy: ['nw[amenity=pharmacy]'],
  water: ['nw[amenity=drinking_water][access!~"^(private|no)$"]'],
  playground: ['nw[leisure=playground][access!~"^(private|no)$"]'],
};

/** Sans cela, une boutique de pâtisserie serait à la fois « Goûter » et « Boutiques » : le premier l'emporte. */
const ORDER: NearbyBuiltin[] = ['snack', 'food', 'toilets', 'pharmacy', 'water', 'playground', 'shops'];

/** Résultats bruts par requête, plus nombreux que ce qu'on garde : le tri par distance se fait ensuite. */
const OUT_LIMIT = 120;

type Element = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
type Raw = { id: string; category: string; lat: number; lng: number; tags: Record<string, string> };

/** Mêmes clauses que les thèmes du générateur (osm.ts), avec ou sans nom selon la catégorie. */
function interestClauses(filters: ThemeFilter[]): string[] {
  return filters.map((f) => (f.values === null ? `nw[${f.key}][name]` : `nw[${f.key}~"^(${f.values.join('|')})$"][name]`));
}

/** Requête Overpass : un jeu de résultats par catégorie, pour qu'aucune ne soit évincée par la limite. */
export function nearbyQuery(center: { lat: number; lng: number }, radius: number, interests: Interest[]): { query: string; categories: string[] } {
  const sets: [string, string[]][] = [
    ...interests.map((it, i) => [`interest-${i}`, interestClauses(it.filters)] as [string, string[]]),
    ...ORDER.map((id) => [id, CLAUSES[id]] as [string, string[]]),
  ];
  const body = sets.map(([id, clauses], i) => `(\n${clauses.map((c) => `  ${c};`).join('\n')}\n)->.s${i};\n.s${i} out center tags ${OUT_LIMIT};`).join('\n');
  return { query: `[out:json][timeout:20][bbox:${bboxAround(center, radius)}];\n${body}`, categories: sets.map(([id]) => id) };
}

/**
 * Overpass renvoie les jeux de résultats à la suite, sans séparateur : on rattache chaque
 * élément à la première catégorie dont il vérifie les tags.
 */
function categorize(tags: Record<string, string>, ids: string[], interests: Interest[]): string | null {
  for (const id of ids) {
    if (id.startsWith('interest-')) {
      const filters = interests[Number(id.slice(9))]?.filters ?? [];
      if (tags['name'] && filters.some((f) => tags[f.key] !== undefined && (f.values === null || f.values.includes(tags[f.key])))) return id;
      continue;
    }
    if (matchesBuiltin(id as NearbyBuiltin, tags)) return id;
  }
  return null;
}

function matchesBuiltin(id: NearbyBuiltin, t: Record<string, string>): boolean {
  const open = (blocked: RegExp) => !blocked.test(t['access'] ?? '');
  switch (id) {
    case 'snack':
      return !!t['name'] && (/^(cafe|ice_cream)$/.test(t['amenity'] ?? '') || /^(bakery|pastry|confectionery|chocolate)$/.test(t['shop'] ?? ''));
    case 'food':
      return !!t['name'] && /^(restaurant|fast_food|biergarten)$/.test(t['amenity'] ?? '');
    case 'shops':
      return !!t['name'] && !!t['shop'];
    case 'toilets':
      return t['amenity'] === 'toilets' && open(/^(private|no|customers)$/);
    case 'pharmacy':
      return t['amenity'] === 'pharmacy';
    case 'water':
      return t['amenity'] === 'drinking_water' && open(/^(private|no)$/);
    case 'playground':
      return t['leisure'] === 'playground' && open(/^(private|no)$/);
  }
}

function address(t: Record<string, string>): string | null {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return street || null;
}

/** Durée de vie du cache, et nombre d'entrées au plus. */
const CACHE_MS = 15 * 60_000;
const CACHE_MAX = 300;
/** Grille du cache : 0,002° ≈ 200 m ; la zone interrogée est élargie d'autant pour couvrir le joueur où qu'il soit dans sa case. */
const GRID = 0.002;
const GRID_MARGIN_M = 160;

export class OsmNearby implements NearbyFinder {
  private readonly cache = new Map<string, { at: number; raw: Promise<Raw[]> }>();

  constructor(private readonly now: () => number = Date.now) {}

  async find(center: { lat: number; lng: number }, radius: number, interests: Interest[] = []): Promise<NearbyResult> {
    const safe = interests
      .map((it) => ({ label: it.label, filters: safeThemeFilters(it.filters) }))
      .filter((it) => it.filters.length)
      .slice(0, 3);
    const found = await this.raw(center, radius, safe);
    const categories: NearbyCategory[] = [
      ...safe.map((it, i) => ({ id: `interest-${i}`, label: it.label, icon: 'favorite' })),
      ...NEARBY_CATEGORIES.map(({ id, label, icon }) => ({ id, label, icon })),
    ];
    const builtinLabel = Object.fromEntries(categories.map((c) => [c.id, c.label]));
    const places: NearbyPlace[] = found
      .map((r) => ({ r, distance: Math.round(distanceMeters(center, r)) }))
      .filter(({ distance }) => distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .map(({ r, distance }) => ({
        id: r.id,
        name: r.tags['name']?.trim() || null,
        category: r.category,
        kind: nearbyKind(r.tags, builtinLabel[r.category] ?? 'Lieu'),
        lat: r.lat,
        lng: r.lng,
        distance,
        hours: hoursLabel(r.tags['opening_hours']),
        address: address(r.tags),
      }));
    // Les plus proches de chaque catégorie.
    const kept = new Map<string, number>();
    const limited = places.filter((p) => {
      const n = kept.get(p.category) ?? 0;
      kept.set(p.category, n + 1);
      return n < NEARBY_PER_CATEGORY;
    });
    return { radius, categories, places: limited };
  }

  /** Lieux de la case de grille du joueur, depuis le cache ou Overpass. */
  private raw(center: { lat: number; lng: number }, radius: number, interests: Interest[]): Promise<Raw[]> {
    const cell = { lat: Math.round(center.lat / GRID) * GRID, lng: Math.round(center.lng / GRID) * GRID };
    const key = `${cell.lat.toFixed(3)},${cell.lng.toFixed(3)},${radius},${JSON.stringify(interests.map((i) => i.filters))}`;
    const now = this.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.raw;
    const entry = { at: now, raw: this.fetch(cell, radius + GRID_MARGIN_M, interests) };
    // Un échec ne reste pas en cache : le prochain joueur réessaie.
    entry.raw.catch(() => {
      if (this.cache.get(key) === entry) this.cache.delete(key);
    });
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return entry.raw;
  }

  private async fetch(center: { lat: number; lng: number }, radius: number, interests: Interest[]): Promise<Raw[]> {
    const { query, categories } = nearbyQuery(center, radius, interests);
    const data = (await osmFetch(config.overpassUrls, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    })) as { elements?: Element[] };
    const seen = new Set<string>();
    const out: Raw[] = [];
    for (const e of data.elements ?? []) {
      const id = `${e.type[0]}${e.id}`;
      const lat = e.lat ?? e.center?.lat;
      const lng = e.lon ?? e.center?.lon;
      if (seen.has(id) || lat === undefined || lng === undefined) continue;
      seen.add(id);
      const tags = e.tags ?? {};
      const category = categorize(tags, categories, interests);
      if (category) out.push({ id, category, lat, lng, tags });
    }
    return out;
  }
}
