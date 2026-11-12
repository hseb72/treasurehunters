/**
 * Parcours d'initialisation (docs/conception.md § 51) : des Secret Tracks écrites hors de
 * l'application (un fichier JSON par parcours, versionné dans db/seeds/catalog/), importées et
 * partagées au catalogue sous le compte « SecretTracks ». Marquées « pas encore éprouvées sur
 * place » jusqu'à ce que MEASURED_MIN équipes en soient arrivées.
 */
import type { Difficulty, Travel } from './models.js';
import type { AudienceTag, PracticalTag, Setting } from './practical.js';
import type { Puzzle } from './puzzles.js';

/** Un lieu du parcours, dans l'ordre : le premier est le départ, le dernier l'arrivée. */
export interface SeedStep {
  title: string;
  lat: number;
  lng: number;
  address?: string;
  /** Message lu en arrivant sur ce lieu (pas pour le départ). */
  arrival?: string;
  /** Énigme qui mène au lieu SUIVANT (pas pour l'arrivée). */
  riddle?: string;
  /** Trois jokers de cette énigme, du plus discret au plus direct. */
  hints?: string[];
  /**
   * Épreuve d'arrivée (§ 17), réponse comprise, pas pour le départ. Offerte aux joueurs du
   * parcours ; un organisateur qui le copie ne la garde que s'il possède le pack de son type.
   */
  puzzle?: Puzzle;
  /** Photo libre de Wikimedia Commons (« File:… »), montrée aux joueurs ; celle du départ fait la couverture. */
  photo?: string;
}

export interface SeedHunt {
  /** Identifiant stable du parcours (« paris-03-marais ») : un import ne le duplique jamais. */
  key: string;
  name: string;
  location: string;
  summary: string;
  /** Consignes de rendez-vous, affichées avant le départ. */
  startText: string;
  travel: Travel;
  difficulty: Difficulty;
  durationMinutes: number;
  audience: AudienceTag[];
  setting: Setting | null;
  practical: PracticalTag[];
  minAge: number | null;
  /** Rayon d'arrivée, en mètres (40 par défaut). */
  geoRadius?: number;
  /** Étape dont l'énigme sert d'extrait sur la fiche (1 par défaut : celle qui mène à la 2ᵉ étape). */
  sampleOrder?: number;
  steps: SeedStep[];
}

export const SEED_KEY = /^[a-z0-9][a-z0-9-]{2,79}$/;
export const SEED_MIN_STEPS = 4;
export const SEED_MAX_STEPS = 14;
/** Distance maximale entre deux lieux consécutifs, selon le déplacement, en km. */
export const SEED_MAX_LEG_KM: Record<Travel, number> = { walk: 1.5, active: 6, motor: 40 };

/* ---------------------------------------------------------------- Export / import d'une chasse (§ 52) */

/** Version du format d'export d'une chasse. */
export const HUNT_FILE_FORMAT = 'secrettracks/hunt@1';

/** Un lieu d'une chasse exportée : comme SeedStep, la position pouvant manquer et une épreuve d'arrivée possible. */
export interface HuntFileStep {
  title: string;
  lat: number | null;
  lng: number | null;
  address?: string | null;
  arrival?: string | null;
  /** Énigme qui mène au lieu SUIVANT (pas pour l'arrivée). */
  riddle?: string | null;
  hints?: string[];
  /** Épreuve d'arrivée (§ 17), réponse comprise. */
  puzzle?: Puzzle | null;
  /** Photo libre de Wikimedia Commons (« File:… »), quand c'en est une. */
  photo?: string | null;
}

/**
 * Une chasse exportée en JSON, pour la faire réécrire (par une IA, à la main) puis la réimporter.
 * Mêmes noms que SeedHunt : un fichier exporté sert aussi de point de départ à un parcours d'initialisation.
 */
export interface HuntFile {
  format: typeof HUNT_FILE_FORMAT;
  name: string;
  location: string;
  /** Présentation (description de la chasse). */
  summary: string;
  startText: string;
  travel: Travel;
  difficulty: Difficulty;
  durationMinutes: number;
  steps: HuntFileStep[];
}

/** Réponse d'un import : à blanc (aperçu) ou appliqué. */
export interface HuntImportResult {
  /** replace : la chasse est réécrite ; copy : déjà jouée (ou pas la vôtre), une nouvelle version est créée en brouillon. */
  mode: 'replace' | 'copy';
  applied: boolean;
  /** La chasse réécrite ou créée (celle d'origine pour un aperçu). */
  huntId: number;
  steps: number;
  /** Ce qui mérite une relecture ; n'empêche pas l'import. */
  warnings: string[];
}
