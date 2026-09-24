/**
 * Modèle du domaine, aligné sur docs/conception.md (§ 6).
 * Les dates sont des chaînes ISO 8601 en UTC, telles que renvoyées par l'API.
 */

export type HuntStatus = 'draft' | 'published' | 'running' | 'closed' | 'cancelled' | 'archived';

/** 'mass' = départ groupé, 'staggered' = départ échelonné (§ 5.1). */
export type StartMode = 'mass' | 'staggered';

export interface Hunter {
  id: number;
  nickname: string;
  email: string;
}

export interface Hunt {
  id: number;
  ownerId: number;
  ownerNickname: string;
  name: string;
  description: string;
  location: string;
  /** Dates prévues. */
  begin: string;
  end: string;
  /** Horodatages réels du déclenchement et de la clôture. */
  started: string | null;
  closed: string | null;
  autoStart: boolean;
  autoClose: boolean;
  award: string | null;
  startMode: StartMode;
  /** Minutes entre deux départs (mode échelonné). */
  interval: number | null;
  /** Minutes de pénalité par niveau de joker : [joker 1, joker 2, joker 3]. */
  hintPenalties: number[];
  teamGame: boolean;
  teamMin: number;
  teamMax: number;
  isPublic: boolean;
  joinCode: string;
  contribution: number;
  startText: string | null;
  status: HuntStatus;
  stepCount: number;
  teamCount: number;
}

/** Étape du parcours. L'ordre 0 est le départ (sans QR), l'ordre max est l'arrivée. */
export interface Step {
  id: number;
  huntId: number;
  order: number;
  token: string | null;
  title: string;
  /** Message affiché au scan de l'étape. */
  arrival: string | null;
  /** Énigme menant à l'étape suivante (null pour l'arrivée). */
  instructions: string | null;
  hints: string[];
  answer: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export interface Member {
  hunterId: number;
  nickname: string;
}

export interface Team {
  id: number;
  huntId: number;
  name: string;
  ownerId: number;
  joinCode: string;
  solo: boolean;
  startOrder: number | null;
  started: string | null;
  finished: string | null;
  members: Member[];
}

export interface Validation {
  teamId: number;
  stepId: number;
  hunterId: number;
  source: 'QR' | 'MANUAL';
  at: string;
}

export interface HintUse {
  teamId: number;
  stepId: number;
  level: number;
  hunterId: number;
  at: string;
}

/* ---------- Vues calculées ---------- */

export interface RankingRow {
  /** null si l'équipe n'est pas arrivée (non classée). */
  rank: number | null;
  teamId: number;
  teamName: string;
  members: string[];
  started: string | null;
  finished: string | null;
  steps: number;
  hints: number;
  /** Temps de course en secondes, pénalités incluses ; null si non arrivée. */
  time: number | null;
  penalty: number;
  lastValidation: string | null;
}

export interface PlayStep {
  order: number;
  title: string;
  arrival: string | null;
  at: string;
}

export interface PlayClue {
  stepId: number;
  /** Ordre de l'étape à trouver. */
  targetOrder: number;
  instructions: string;
  hintsRevealed: string[];
  hintsTotal: number;
}

export interface PlayState {
  hunt: Hunt;
  team: Team;
  totalSteps: number;
  validated: PlayStep[];
  /** Énigme en cours ; null avant le départ ou après l'arrivée. */
  clue: PlayClue | null;
  hintsUsed: number;
  /** Pénalités cumulées, en minutes. */
  penalty: number;
  /** Position provisoire de l'équipe (les joueurs ne voient pas celle des autres). */
  position: { rank: number; total: number } | null;
}

export interface AuthResult {
  user: Hunter;
  token: string;
}

/** Résultats possibles d'un scan, dans l'ordre d'évaluation (§ 4.2). */
export type ScanOutcome =
  | 'unknown'
  | 'cancelled'
  | 'not_started'
  | 'closed'
  | 'login_required'
  | 'not_registered'
  | 'organizer'
  | 'team_not_started'
  | 'team_finished'
  | 'already_validated'
  | 'skipped'
  | 'validated';

export interface ScanResult {
  outcome: ScanOutcome;
  hunt: Hunt | null;
  /** Étape scannée (titre et message d'arrivée seulement si l'accès est autorisé). */
  step: { order: number; title: string; arrival: string | null; isFinal: boolean } | null;
  /** Énigme suivante, si débloquée. */
  next: PlayClue | null;
  team: Team | null;
  podium: RankingRow[] | null;
}

export interface LiveRow {
  team: Team;
  /** Ordre de la dernière étape validée (0 = parti, pas encore d'étape). */
  lastOrder: number;
  lastAt: string | null;
  hints: number;
  status: 'waiting' | 'running' | 'finished';
}
