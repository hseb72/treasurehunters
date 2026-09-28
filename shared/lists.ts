/**
 * Favoris et listes (docs/conception.md § 38) : « Mes Secret Tracks à faire », puis des listes
 * à soi (« Week-end à Toulouse », « Avec les enfants »…), que l'on peut partager par un code
 * pour les remplir à plusieurs.
 */
import type { CatalogEntry } from './models.js';

export interface TrackList {
  id: number;
  name: string;
  /** Icône Material de la liste. */
  icon: string;
  /** La liste « À faire » du joueur, créée d'office, qui ne se supprime pas. */
  favorite: boolean;
  ownerNickname: string;
  /** Le lecteur l'a créée (il la renomme, la supprime, en retire les membres). */
  mine: boolean;
  /** Code de partage, connu des membres ; null tant que la liste n'est pas partagée. */
  code: string | null;
  /** Autres membres (pseudos), propriétaire exclu. */
  members: string[];
  /** Versions du catalogue de la liste, les plus récemment ajoutées d'abord. */
  catalogIds: number[];
}

export interface TrackListDetail extends TrackList {
  entries: CatalogEntry[];
}

export const LIST_MAX_ITEMS = 200;
export const LISTS_MAX = 30;
export const FAVORITE_NAME = 'À faire';

/** Icônes proposées pour une liste. */
export const LIST_ICONS = ['bookmark', 'favorite', 'place', 'castle', 'family_restroom', 'search', 'restaurant', 'wb_sunny', 'forest', 'museum'];
