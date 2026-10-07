/**
 * « Autour de moi » (docs/conception.md § 45) : pendant la partie, les adresses utiles près
 * du joueur (goûter, restaurants, boutiques, toilettes…), tirées d'OpenStreetMap.
 */
import { Travel } from './models.js';

/** Catégories toujours proposées ; les centres d'intérêt de l'équipe s'y ajoutent (« interest-0 »…). */
export type NearbyBuiltin = 'snack' | 'food' | 'shops' | 'toilets' | 'pharmacy' | 'water' | 'playground';

export interface NearbyCategory {
  /** Une catégorie fixe, ou « interest-N » pour un centre d'intérêt de l'équipe. */
  id: string;
  label: string;
  /** Icône Material Symbols. */
  icon: string;
}

export const NEARBY_CATEGORIES: (NearbyCategory & { id: NearbyBuiltin })[] = [
  { id: 'snack', label: 'Goûter, café', icon: 'local_cafe' },
  { id: 'food', label: 'Restaurants', icon: 'restaurant' },
  { id: 'shops', label: 'Boutiques', icon: 'storefront' },
  { id: 'toilets', label: 'Toilettes', icon: 'wc' },
  { id: 'pharmacy', label: 'Pharmacie', icon: 'local_pharmacy' },
  { id: 'water', label: 'Eau potable', icon: 'water_drop' },
  { id: 'playground', label: 'Aires de jeux', icon: 'toys' },
];

/** Adresse utile près du joueur. */
export interface NearbyPlace {
  /** Identifiant OpenStreetMap (« n123 », « w42 »). */
  id: string;
  /** Les toilettes, fontaines et aires de jeux n'ont souvent pas de nom. */
  name: string | null;
  category: string;
  /** Nature du lieu en français : « Boulangerie », « Glacier »… */
  kind: string;
  lat: number;
  lng: number;
  /** Distance à vol d'oiseau depuis le joueur, en mètres. */
  distance: number;
  /** Horaires OpenStreetMap, rendus lisibles (null s'ils ne sont pas renseignés). */
  hours: string | null;
  address: string | null;
}

export interface NearbyResult {
  radius: number;
  /** Catégories proposées, centres d'intérêt de l'équipe en premier. */
  categories: NearbyCategory[];
  /** Du plus proche au plus lointain. */
  places: NearbyPlace[];
}

/** Rayon de recherche selon le déplacement de la chasse : quelques minutes de détour. */
export const NEARBY_RADIUS: Record<Travel, number> = { walk: 500, active: 1000, motor: 2000 };
export const NEARBY_MAX_RADIUS = 2000;
/** Adresses gardées par catégorie, les plus proches. */
export const NEARBY_PER_CATEGORY = 25;

/** Nature du lieu, depuis ses tags : les valeurs courantes traduites, sinon la catégorie. */
const KINDS: Record<string, Record<string, string>> = {
  amenity: {
    cafe: 'Café',
    ice_cream: 'Glacier',
    restaurant: 'Restaurant',
    fast_food: 'Restauration rapide',
    biergarten: 'Brasserie',
    toilets: 'Toilettes',
    pharmacy: 'Pharmacie',
    drinking_water: 'Point d’eau potable',
  },
  shop: {
    bakery: 'Boulangerie',
    pastry: 'Pâtisserie',
    confectionery: 'Confiserie',
    chocolate: 'Chocolatier',
    clothes: 'Vêtements',
    shoes: 'Chaussures',
    sports: 'Articles de sport',
    books: 'Librairie',
    toys: 'Jouets',
    gift: 'Cadeaux, souvenirs',
    supermarket: 'Supermarché',
    convenience: 'Épicerie',
    greengrocer: 'Primeur',
    butcher: 'Boucherie',
    cheese: 'Fromagerie',
    wine: 'Caviste',
    florist: 'Fleuriste',
    jewelry: 'Bijouterie',
    optician: 'Opticien',
    hairdresser: 'Coiffeur',
    bag: 'Maroquinerie',
    boutique: 'Boutique de mode',
    second_hand: 'Dépôt-vente',
    art: 'Galerie d’art',
    music: 'Disquaire',
    games: 'Jeux',
    bicycle: 'Cycles',
    outdoor: 'Plein air',
    mobile_phone: 'Téléphonie',
    electronics: 'Électronique',
    cosmetics: 'Cosmétiques',
    perfumery: 'Parfumerie',
    tobacco: 'Tabac',
    newsagent: 'Presse',
    deli: 'Épicerie fine',
    tea: 'Thé',
    coffee: 'Café (boutique)',
  },
  leisure: { playground: 'Aire de jeux', park: 'Parc' },
};

const FALLBACK_KIND: Record<string, string> = { amenity: 'Service', shop: 'Boutique', leisure: 'Loisirs', tourism: 'Tourisme', craft: 'Artisan' };

export function nearbyKind(tags: Record<string, string>, fallback: string): string {
  for (const key of ['shop', 'amenity', 'leisure', 'tourism', 'craft']) {
    const value = tags[key];
    if (!value) continue;
    return KINDS[key]?.[value] ?? FALLBACK_KIND[key] ?? fallback;
  }
  return fallback;
}

const DAYS: [RegExp, string][] = [
  [/\bMo\b/g, 'lun'],
  [/\bTu\b/g, 'mar'],
  [/\bWe\b/g, 'mer'],
  [/\bTh\b/g, 'jeu'],
  [/\bFr\b/g, 'ven'],
  [/\bSa\b/g, 'sam'],
  [/\bSu\b/g, 'dim'],
  [/\bPH\b/g, 'fériés'],
  [/\boff\b/gi, 'fermé'],
  [/\bclosed\b/gi, 'fermé'],
];

/** Horaires OpenStreetMap (« Mo-Sa 08:00-19:30; Su off ») en français lisible. */
export function hoursLabel(raw: string | undefined | null): string | null {
  const text = raw?.trim();
  if (!text) return null;
  if (text === '24/7') return 'Ouvert 24 h/24';
  let out = text;
  for (const [re, fr] of DAYS) out = out.replace(re, fr);
  return out
    .replace(/(\d{2}):(\d{2})/g, (_, h, m) => `${Number(h)}h${m === '00' ? '' : m}`)
    .replace(/\s*;\s*/g, ' · ')
    .replace(/,/g, ', ')
    .slice(0, 160);
}

/** Lien d'itinéraire à pied vers le lieu, dans l'application de cartes du téléphone. */
export function directionsUrl(place: { lat: number; lng: number }, apple: boolean): string {
  const at = `${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;
  return apple ? `https://maps.apple.com/?daddr=${at}&dirflg=w` : `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=walking`;
}
