/**
 * Boutique d'extensions (docs/conception.md § 16) : univers graphiques (skins) et outils de
 * jeu qu'un organisateur ajoute à ses chasses. Les prix sont affichés, mais l'acquisition
 * reste offerte tant que le paiement n'est pas branché ; la possession est enregistrée.
 */
import { SKINS } from './skins.js';

export type ProductKind = 'skin' | 'tool' | 'pack';

/** Outils de jeu : ce que le carnet de route propose aux joueurs d'une chasse. */
export const TOOL_IDS = ['map', 'compass', 'live'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface Product {
  /** Identifiant de produit : « skin:medieval », « tool:compass ». */
  id: string;
  kind: ProductKind;
  /** Identifiant dans son genre : id du skin ou de l'outil. */
  ref: string;
  name: string;
  description: string;
  /** Prix en centimes d'euro, affiché ; 0 = inclus. */
  price: number;
  /** Inclus d'office : chacun le possède sans l'acquérir. */
  included: boolean;
  /** Image (skins) ou icône Material Symbols (outils). */
  cover: string | null;
  icon: string | null;
}

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  icon: string;
  price: number;
  /** Ne sert que si les étapes sont placées sur la carte. */
  needsPlaces: boolean;
}

export const TOOLS: ToolDefinition[] = [
  {
    id: 'map',
    name: 'Carte',
    description: 'Une carte du parcours déjà accompli : le départ, les lieux trouvés et la position de l’équipe. Jamais le prochain lieu.',
    icon: 'map',
    price: 199,
    needsPlaces: true,
  },
  {
    id: 'compass',
    name: 'Boussole',
    description: 'Sur demande, la direction du prochain lieu et une fourchette de distance (« entre 100 et 300 m, vers le nord-est »).',
    icon: 'explore',
    price: 299,
    needsPlaces: true,
  },
  {
    id: 'live',
    name: 'Position en direct',
    description: 'Le classement provisoire de l’équipe pendant la course (« 4ᵉ sur 6 »), pour garder le suspense.',
    icon: 'military_tech',
    price: 0,
    needsPlaces: false,
  },
];

/** Packs d'énigmes d'arrivée (§ 17) : chacun apporte des types d'énigmes. */
export const PACKS: { id: string; name: string; description: string; icon: string; price: number }[] = [
  {
    id: 'pack:question',
    name: 'Question sur place',
    description: 'Une question dont la réponse se lit sur le lieu : une date gravée, un nom, un symbole.',
    icon: 'quiz',
    price: 0,
  },
  {
    id: 'pack:codes',
    name: 'Codes secrets',
    description: 'Cadenas à molettes et messages chiffrés à la roue de César, à ouvrir sur place.',
    icon: 'lock',
    price: 299,
  },
  {
    id: 'pack:lettres',
    name: 'Jeux de lettres',
    description: 'Anagrammes à remettre dans l’ordre et rébus en images.',
    icon: 'abc',
    price: 299,
  },
];

/** Univers inclus d'office ; les autres s'obtiennent en boutique. */
const INCLUDED_SKINS = ['aventure', 'epure'];
/** Prix affiché des univers de la boutique. */
const SKIN_PRICE = 299;

export const PRODUCTS: Product[] = [
  ...SKINS.map((s) => {
    const included = INCLUDED_SKINS.includes(s.id);
    return {
      id: `skin:${s.id}`,
      kind: 'skin' as const,
      ref: s.id,
      name: s.name,
      description: s.description,
      price: included ? 0 : s.price || SKIN_PRICE,
      included,
      cover: s.cover,
      icon: null,
    };
  }),
  ...PACKS.map((p) => ({
    id: p.id,
    kind: 'pack' as const,
    ref: p.id.slice(5),
    name: p.name,
    description: p.description,
    price: p.price,
    included: p.price === 0,
    cover: null,
    icon: p.icon,
  })),
  ...TOOLS.map((t) => ({
    id: `tool:${t.id}`,
    kind: 'tool' as const,
    ref: t.id,
    name: t.name,
    description: t.description,
    price: t.price,
    included: t.price === 0,
    cover: null,
    icon: t.icon,
  })),
];

export const PRODUCT_IDS = PRODUCTS.map((p) => p.id) as [string, ...string[]];

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

/** Le joueur possède-t-il ce produit : inclus, ou acquis. */
export function owns(owned: ReadonlySet<string>, productId: string): boolean {
  return !!productById(productId)?.included || owned.has(productId);
}

/** Outils d'une nouvelle chasse : la position en direct, comme avant la boutique. */
export const DEFAULT_TOOLS: ToolId[] = ['live'];

/** Prix lisible : « 2,99 € », « Inclus ». */
export function priceLabel(p: Pick<Product, 'price' | 'included'>): string {
  return p.included || !p.price ? 'Inclus' : `${(p.price / 100).toFixed(2).replace('.', ',')} €`;
}

/* ---------------------------------------------------------------- Boussole */

const DIRECTIONS = ['le nord', 'le nord-est', 'l’est', 'le sud-est', 'le sud', 'le sud-ouest', 'l’ouest', 'le nord-ouest'];

/** Cap de a vers b, en degrés depuis le nord (0 à 360). */
export function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const φ1 = a.lat * rad;
  const φ2 = b.lat * rad;
  const Δλ = (b.lng - a.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360;
}

/**
 * Indication de la boussole : un cap arrondi à 45° (huit directions) et une fourchette de
 * distance, jamais la position exacte du lieu.
 */
export function compassReading(from: { lat: number; lng: number }, to: { lat: number; lng: number }, distance: number): { bearing: number; direction: string; band: string } {
  const sector = Math.round(bearingDegrees(from, to) / 45) % 8;
  const band =
    distance < 50
      ? 'tout près, à moins de 50 m'
      : distance < 150
        ? 'entre 50 et 150 m'
        : distance < 400
          ? 'entre 150 et 400 m'
          : distance < 1000
            ? 'entre 400 m et 1 km'
            : distance < 3000
              ? 'entre 1 et 3 km'
              : 'à plus de 3 km';
  return { bearing: sector * 45, direction: DIRECTIONS[sector], band };
}
