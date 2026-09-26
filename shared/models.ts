/**
 * Modèle du domaine, aligné sur docs/conception.md (§ 6).
 * Les dates sont des chaînes ISO 8601 en UTC, telles que renvoyées par l'API.
 */

export type HuntStatus = 'draft' | 'published' | 'running' | 'closed' | 'cancelled' | 'archived';

/** 'mass' = départ groupé, 'staggered' = départ échelonné (§ 5.1). */
export type StartMode = 'mass' | 'staggered';

/** Comment une étape se valide : QR code scanné, ou présence sur place (géolocalisation). */
export type ValidationMode = 'qr' | 'geo';

export interface Hunter {
  id: number;
  nickname: string;
  email: string;
  /** Accepte d'être noté en tant qu'organisateur (§ 14). */
  rateable: boolean;
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
  /** Minutes de pénalité pour l'abandon d'une épreuve (« 4ᵉ joker »). */
  skipPenalty: number;
  /** Validation des étapes : QR code, ou géolocalisation (chasses générées, sans QR). */
  validation: ValidationMode;
  /** Rayon d'arrivée en mètres pour la validation par géolocalisation. */
  geoRadius: number;
  /** Chasse inventée par le générateur (OpenStreetMap + IA). */
  generated: boolean;
  /** Chasse surprise : le joueur l'a générée pour lui-même et n'en voit pas le détail. */
  surprise: boolean;
  /** Chasse surprise : le joueur qui l'a générée (l'organisateur est le compte système). */
  hostId: number | null;
  hostNickname: string | null;
  /**
   * Chasse surprise : chaque équipe donne son propre départ quand elle veut (true), ou
   * l'hôte lance la course pour toutes les équipes à la fois (false).
   */
  selfPaced: boolean;
  /** Entrée du catalogue dont la chasse est une copie (§ 13). */
  catalogId: number | null;
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
  /** L'organisateur a déposé une photo du lieu, référence pour la preuve par photo. */
  referencePhoto: boolean;
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
  /** QR scanné, validation manuelle, épreuve abandonnée, géolocalisation, ou photo du lieu. */
  source: 'QR' | 'MANUAL' | 'SKIP' | 'GEO' | 'PHOTO';
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
  /** Épreuves abandonnées. */
  skips: number;
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
  /** Épreuve abandonnée plutôt que trouvée. */
  skipped: boolean;
  /** Étape validée par photo : contrôle de l'organisateur (une photo refusée compte comme un abandon). */
  photo: PhotoReview | null;
}

export interface PlayClue {
  stepId: number;
  /** Ordre de l'étape à trouver. */
  targetOrder: number;
  instructions: string;
  hintsRevealed: string[];
  hintsTotal: number;
  /** L'équipe peut abandonner cette épreuve (jamais l'arrivée). */
  canSkip: boolean;
}

export interface PlayState {
  hunt: Hunt;
  team: Team;
  totalSteps: number;
  validated: PlayStep[];
  /** Énigme en cours ; null avant le départ ou après l'arrivée. */
  clue: PlayClue | null;
  hintsUsed: number;
  skipsUsed: number;
  /** Pénalités cumulées (jokers et abandons), en minutes. */
  penalty: number;
  /** Position provisoire de l'équipe (les joueurs ne voient pas celle des autres). */
  position: { rank: number; total: number } | null;
  /** Chasse surprise : le joueur peut donner le départ (de son équipe, ou de tous en départ commun). */
  selfStart: boolean;
  /** QR introuvable : l'équipe peut envoyer une photo du lieu (chasses à QR, stockage configuré). */
  photoProof: boolean;
}

/* ---------- Preuve par photo (§ 12) ---------- */

/** Contrôle de l'organisateur sur une photo qui a validé une étape. */
export type PhotoReview = 'pending' | 'approved' | 'rejected';

export interface PhotoAttempt {
  id: number;
  teamId: number;
  teamName: string;
  stepId: number;
  stepOrder: number;
  stepTitle: string;
  nickname: string | null;
  at: string;
  /** Avis de l'IA : 'match' valide l'étape ; 'nomatch' ou 'unavailable' : l'équipe réessaie ou insiste. */
  verdict: 'match' | 'nomatch' | 'unavailable';
  reason: string | null;
  /** L'équipe a confirmé sa photo malgré l'avis de l'IA. */
  insisted: boolean;
  /** La photo a validé l'étape (avis favorable, ou équipe qui a insisté) ; null sinon. */
  review: PhotoReview | null;
  /** L'organisateur a déposé une photo de référence pour cette étape. */
  hasReference: boolean;
  /** Photo effacée (clôture de la chasse + 30 jours). */
  purged: boolean;
}

/** Réponse à l'envoi d'une photo, ou à l'insistance de l'équipe. */
export interface PhotoResult {
  photo: PhotoAttempt;
  state: PlayState;
}

/** Fonctions activées sur ce serveur. */
export interface Features {
  photos: boolean;
  generation: boolean;
}

/** Résultat d'un « Je suis arrivé » (validation par géolocalisation). */
export interface CheckinResult {
  outcome: 'validated' | 'too_far';
  /** Distance au lieu cherché, en mètres (arrondie). */
  distance: number;
  /** Distance maximale acceptée pour ce check-in, en mètres. */
  allowed: number;
  step: { order: number; title: string; arrival: string | null; isFinal: boolean } | null;
  state: PlayState;
}

/* ---------- Génération de chasses ---------- */

/** Difficulté des énigmes. */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Déplacement : 'walk' = Balade (à pied, détente) ; 'active' = Aventure (à pied d'un bon pas,
 * vélo, trottinette) ; 'motor' = Expédition (véhicule motorisé : moto, voiture…).
 */
export type Travel = 'walk' | 'active' | 'motor';

export interface GenerationRequest {
  /** Lieu : nom de ville ou d'adresse, OU coordonnées (carte, position du téléphone). */
  location: { query?: string; lat?: number; lng?: number };
  /** Durée approximative de la chasse, en minutes. */
  durationMinutes: number;
  travel: Travel;
  difficulty: Difficulty;
  /** Thème libre (« boutiques de chaussures », « parcs et coulées vertes »…), suivi s'il est réalisable. */
  theme: string | null;
  /** Nombre d'étapes à trouver (arrivée comprise) ; null = déduit de la durée. */
  steps: number | null;
  /** 'play' : chasse surprise pour soi ; 'organize' : l'utilisateur en devient l'organisateur. */
  mode: 'play' | 'organize';
}

export interface GenerationJob {
  id: string;
  status: 'pending' | 'done' | 'error';
  mode: 'play' | 'organize';
  huntId: number | null;
  error: string | null;
  /** Comment le thème demandé a été suivi, ou pourquoi il n'a pas pu l'être. */
  note: string | null;
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
  skips: number;
  status: 'waiting' | 'running' | 'finished';
  /** Photos qui ont validé une étape et attendent le contrôle de l'organisateur. */
  photosToReview: number;
}

/* ---------- Catalogue (§ 13) et notations (§ 14) ---------- */

/** Moyennes des avis des joueurs (sur 5), null s'il n'y en a pas. */
export interface RatingSummary {
  count: number;
  stars: number | null;
  riddles: number | null;
  route: number | null;
  mood: number | null;
}

/** Une version publiée au catalogue, telle que la liste la présente. */
export interface CatalogEntry {
  id: number;
  authorId: number;
  authorNickname: string;
  title: string;
  summary: string;
  location: string;
  difficulty: Difficulty;
  /** Durée annoncée par l'auteur, en minutes. */
  durationMinutes: number;
  /** Durée moyenne constatée des équipes arrivées, en minutes (null sans partie). */
  measuredMinutes: number | null;
  stepCount: number;
  validation: ValidationMode;
  /** Parties jouées et closes (chasse d'origine et copies de cette version). */
  plays: number;
  rating: RatingSummary;
  parent: { id: number; title: string; authorNickname: string } | null;
  /** Versions publiées à partir de celle-ci. */
  versionCount: number;
  changes: string | null;
  published: string;
  withdrawn: boolean;
}

export interface CatalogReview {
  nickname: string;
  stars: number;
  comment: string;
  at: string;
}

/** Fiche d'une version : la liste, plus l'extrait, les avis et les versions dérivées. */
export interface CatalogDetail extends CatalogEntry {
  sample: { order: number; text: string };
  reviews: CatalogReview[];
  versions: { id: number; title: string; authorNickname: string; published: string; withdrawn: boolean }[];
  /** Chasse d'où vient la publication, si le lecteur en est l'auteur. */
  huntId: number | null;
}

export interface CatalogPublication {
  summary: string;
  difficulty: Difficulty;
  durationMinutes: number;
  /** Étape dont l'énigme sert d'extrait (0 = énigme de départ). */
  sampleOrder: number;
  changes: string | null;
}

/** Avis d'un joueur sur une chasse jouée, après sa clôture. */
export interface Rating {
  stars: number;
  riddles: number;
  route: number;
  mood: number;
  comment: string | null;
  /** Note de l'organisateur, s'il accepte d'être noté. */
  organizer: number | null;
}

/** Ce qu'un joueur peut noter pour une chasse, et son avis s'il l'a déjà donné. */
export interface RatingState {
  canRate: boolean;
  /** L'organisateur accepte d'être noté. */
  organizerRateable: boolean;
  organizerNickname: string;
  mine: Rating | null;
}

export interface OrganizerProfile {
  id: number;
  nickname: string;
  rateable: boolean;
  /** Moyenne des notes d'organisateur (sur 5), s'il accepte d'être noté. */
  rating: { count: number; stars: number | null } | null;
  entries: CatalogEntry[];
}

