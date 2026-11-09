/**
 * Parcours d'initialisation (docs/conception.md § 51) : des Secret Tracks écrites hors de
 * l'application (un fichier JSON par parcours, versionné dans db/seeds/catalog/), importées et
 * partagées au catalogue sous le compte « SecretTracks ». Marquées « pas encore éprouvées sur
 * place » jusqu'à ce que MEASURED_MIN équipes en soient arrivées.
 */
import type { Difficulty, Travel } from './models.js';
import type { AudienceTag, PracticalTag, Setting } from './practical.js';

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
