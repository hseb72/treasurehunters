import { Observable } from 'rxjs';
import {
  AuthResult,
  CatalogDetail,
  CatalogEntry,
  CatalogPublication,
  CheckinResult,
  Features,
  GenerationJob,
  GenerationRequest,
  Hunt,
  Hunter,
  LiveRow,
  OrganizerProfile,
  PhotoAttempt,
  PhotoResult,
  PlayState,
  RankingRow,
  Rating,
  RatingState,
  ScanResult,
  Step,
  Team,
} from '@shared/models';

export type HuntScope = 'public' | 'playing' | 'organized';
export type HuntAction = 'publish' | 'unpublish' | 'start' | 'close' | 'cancel';

export class ApiError extends Error {}

export interface CatalogQuery {
  q?: string;
  sort?: 'rating' | 'recent' | 'plays';
  mine?: boolean;
  hunt?: number;
}

/**
 * Contrat entre le front et le back-end (docs/conception.md § 7).
 * Implémenté par MockHuntApi pour les maquettes, puis par un client HTTP.
 */
export abstract class HuntApi {
  abstract login(email: string, password: string): Observable<AuthResult>;
  abstract register(nickname: string, email: string, password: string): Observable<AuthResult>;
  abstract logout(): Observable<void>;
  abstract updateMe(data: Partial<Pick<Hunter, 'nickname' | 'email' | 'rateable'>>): Observable<Hunter>;

  abstract listHunts(scope: HuntScope): Observable<Hunt[]>;
  abstract getHunt(id: number): Observable<Hunt>;
  abstract findHuntByCode(code: string): Observable<Hunt>;
  abstract saveHunt(data: Partial<Hunt>): Observable<Hunt>;
  abstract huntAction(id: number, action: HuntAction): Observable<Hunt>;

  abstract getSteps(huntId: number): Observable<Step[]>;
  abstract saveStep(step: Partial<Step> & { huntId: number }): Observable<Step>;
  abstract deleteStep(id: number): Observable<void>;
  abstract reorderSteps(huntId: number, stepIds: number[]): Observable<Step[]>;
  abstract regenerateToken(stepId: number): Observable<Step>;

  abstract getTeams(huntId: number): Observable<Team[]>;
  abstract myTeam(huntId: number): Observable<Team | null>;
  abstract createTeam(huntId: number, name: string): Observable<Team>;
  abstract joinTeam(code: string): Observable<Team>;
  abstract joinSolo(huntId: number): Observable<Team>;
  abstract leaveHunt(huntId: number): Observable<void>;
  abstract setStartOrder(huntId: number, teamIds: number[]): Observable<Team[]>;
  abstract delayTeam(teamId: number, minutes: number): Observable<Team>;

  abstract getPlay(huntId: number): Observable<PlayState>;
  abstract revealHint(huntId: number): Observable<PlayState>;
  /** Abandonne l'épreuve en cours (« 4ᵉ joker ») : pénalité d'abandon, énigme suivante. */
  abstract skipStep(huntId: number): Observable<PlayState>;
  abstract scan(token: string): Observable<ScanResult>;
  /** « Je suis arrivé » : validation de l'étape cherchée par géolocalisation. */
  abstract checkin(huntId: number, pos: { lat: number; lng: number; accuracy: number }): Observable<CheckinResult>;
  /** Chasse surprise : le joueur donne le départ (de son équipe, ou de tous en départ commun). */
  abstract selfStart(huntId: number): Observable<PlayState>;
  /** Chasse surprise, avant le départ : l'hôte choisit « chacun son chrono » ou départ commun. */
  abstract setSelfPaced(huntId: number, selfPaced: boolean): Observable<Hunt>;

  /** Demande l'invention d'une chasse (OpenStreetMap + IA) ; suivie avec getGeneration. */
  abstract generateHunt(request: GenerationRequest): Observable<GenerationJob>;
  abstract getGeneration(id: string): Observable<GenerationJob>;

  /** Fonctions activées sur le serveur (preuve par photo, génération). */
  abstract getFeatures(): Observable<Features>;

  /* Preuve par photo (§ 12) : images en « data URL » JPEG, déjà réduites par le téléphone. */
  /** QR introuvable : photo du lieu, jugée par l'IA. */
  abstract submitPhoto(huntId: number, image: string): Observable<PhotoResult>;
  /** L'équipe confirme une photo que l'IA n'a pas reconnue, à ses risques. */
  abstract insistPhoto(photoId: number): Observable<PhotoResult>;
  abstract huntPhotos(huntId: number): Observable<PhotoAttempt[]>;
  abstract reviewPhoto(photoId: number, approve: boolean): Observable<PhotoAttempt[]>;
  abstract photoImage(photoId: number): Observable<Blob>;
  abstract referenceImage(stepId: number): Observable<Blob>;
  /** Photo de référence d'une étape ; null la retire. */
  abstract setReferencePhoto(stepId: number, image: string | null): Observable<Step>;

  /* Catalogue (§ 13) */
  /** mine : mes publications ; hunt : celles d'une de mes chasses (retirées comprises). */
  abstract listCatalog(opts?: CatalogQuery): Observable<CatalogEntry[]>;
  abstract getCatalogEntry(id: number): Observable<CatalogDetail>;
  /** Crée un brouillon à partir d'une version du catalogue. */
  abstract copyFromCatalog(id: number): Observable<Hunt>;
  abstract withdrawFromCatalog(id: number): Observable<CatalogDetail>;
  abstract publishToCatalog(huntId: number, pub: CatalogPublication): Observable<CatalogDetail>;

  /* Notations (§ 14) */
  abstract getRating(huntId: number): Observable<RatingState>;
  abstract rateHunt(huntId: number, rating: Rating): Observable<RatingState>;
  abstract getOrganizer(id: number): Observable<OrganizerProfile>;

  abstract getResults(huntId: number): Observable<RankingRow[]>;
  abstract getLive(huntId: number): Observable<LiveRow[]>;
  abstract validateManually(teamId: number, stepId: number): Observable<LiveRow[]>;
}
