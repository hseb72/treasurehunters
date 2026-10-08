/**
 * Similitude de deux parcours (docs/conception.md § 48) : une Secret Track n'entre pas au
 * catalogue si plus de 80 % de ses étapes figurent déjà dans une autre, sauf s'il s'agit
 * d'une nouvelle version de la même lignée (corrections, améliorations).
 */
import { distanceMeters } from './rules.js';

/** Au-delà de cette part d'étapes en commun, la proposition est trop proche d'un existant. */
export const SIMILARITY_LIMIT = 0.8;
/** Deux étapes à moins de cette distance désignent le même lieu. */
export const SAME_PLACE_M = 40;

export interface ComparableStep {
  order: number;
  title: string;
  latitude: number | null;
  longitude: number | null;
}

/** Titre comparable : sans accents, casse ni ponctuation. */
function normalized(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function samePlace(a: ComparableStep, b: ComparableStep): boolean {
  if (a.latitude !== null && a.longitude !== null && b.latitude !== null && b.longitude !== null) {
    return distanceMeters({ lat: Number(a.latitude), lng: Number(a.longitude) }, { lat: Number(b.latitude), lng: Number(b.longitude) }) <= SAME_PLACE_M;
  }
  // Étape non placée sur la carte : même titre.
  const t = normalized(a.title);
  return t.length > 0 && t === normalized(b.title);
}

/**
 * Part des étapes de `proposal` (départ exclu, souvent une place centrale commune) qu'on
 * retrouve dans `existing`, chaque étape existante ne servant qu'une fois. De 0 à 1.
 */
export function sharedStepRatio(proposal: ComparableStep[], existing: ComparableStep[]): number {
  const mine = proposal.filter((s) => s.order > 0);
  const theirs = existing.filter((s) => s.order > 0);
  if (!mine.length) return 0;
  const used = new Set<number>();
  let shared = 0;
  for (const s of mine) {
    const i = theirs.findIndex((t, k) => !used.has(k) && samePlace(s, t));
    if (i >= 0) {
      used.add(i);
      shared++;
    }
  }
  return shared / mine.length;
}

/** « 85 % » */
export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}
