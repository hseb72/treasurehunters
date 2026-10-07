import { Observable } from 'rxjs';
import { Creation, CreationInput, CreatorPage } from '@shared/creations';
import { Puzzle } from '@shared/puzzles';
import { SkinManifest } from '@shared/skins';
import { GenerationAccess } from '@shared/generation-access';
import { AssistReply, AssistRequest, AssistUsage } from '@shared/assist';
import { AudienceTag, PracticalTag, Setting } from '@shared/practical';
import { Surprise, SurpriseQuery } from '@shared/surprise';
import { TrackList, TrackListDetail } from '@shared/lists';
import { TeamRole } from '@shared/roles';
import { StepReliability } from '@shared/gps';
import { ExplorerJournal } from '@shared/journal';
import { NearbyResult } from '@shared/nearby';
import { GuideInterest, GuideRequest, GuideUnderstanding } from '@shared/guide';
import { OfflineEvent, OfflinePack, OfflineSyncResult } from '@shared/offline';
import {
  AuthResult,
  HuntStats,
  ReportCategory,
  StepReport,
  AutonomyLeaderboard,
  CheckoutResult,
  PayoutAccount,
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
  Difficulty,
  Travel,
  StoreItem,
  CompassReading,
  PuzzleResult,
  Souvenir,
  Challenge,
  GameInProgress,
} from '@shared/models';

export type HuntScope = 'public' | 'playing' | 'organized';
export type HuntAction = 'publish' | 'unpublish' | 'start' | 'close' | 'cancel';

export class ApiError extends Error {}

export interface CatalogQuery {
  q?: string;
  sort?: 'rating' | 'recent' | 'plays' | 'distance';
  mine?: boolean;
  hunt?: number;
  travel?: Travel[];
  difficulty?: Difficulty[];
  /** Durée annoncée, en minutes. */
  minDuration?: number;
  maxDuration?: number;
  /** Seulement les chasses jouables en autonomie (§ 13.5). */
  autonomous?: boolean;
  /** Près de moi (§ 23) : position du joueur, pour la distance au départ. */
  near?: { lat: number; lng: number };
  /** Rayon autour de `near`, en km. */
  radius?: number;
  /** Repères pratiques exigés (§ 26). */
  practical?: PracticalTag[];
  /** Je cherche une Secret Track… (§ 36) : l'un de ces publics, ce cadre, prix, longueur maximale en km. */
  audience?: AudienceTag[];
  setting?: Setting[];
  price?: 'free' | 'paid';
  maxKm?: number;
  /** Avec une session publique aujourd'hui ou dans la semaine (§ 40). */
  session?: 'today' | 'week';
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
  /* ---------- Mode test (§ 42) ---------- */
  /** Vérification de l'auteur en répétition, notée pour la fiabilité GPS de l'étape. */
  abstract testStep(stepId: number, pos: { lat: number; lng: number; accuracy: number }): Observable<{ distance: number; allowed: number; ok: boolean }>;
  abstract gpsReliability(huntId: number): Observable<StepReliability[]>;
  /** Rôle dans l'équipe (§ 41) : le sien, ou celui d'un équipier pour le créateur de l'équipe. */
  abstract setRole(teamId: number, role: TeamRole | null, hunterId?: number): Observable<Team>;

  abstract getPlay(huntId: number): Observable<PlayState>;
  abstract revealHint(huntId: number): Observable<PlayState>;
  /** Abandonne l'épreuve en cours (« 4ᵉ joker ») : pénalité d'abandon, énigme suivante. */
  abstract skipStep(huntId: number): Observable<PlayState>;
  /** Abandon de la partie : toute l'équipe s'arrête, non classée (§ 5.2). */
  abstract abandonHunt(huntId: number): Observable<PlayState>;
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

  /* Boutique (§ 16) */
  abstract getStore(): Observable<StoreItem[]>;
  /** Obtenir une extension (offerte pour l'instant) ; rend la boutique à jour. */
  abstract acquire(productId: string): Observable<StoreItem[]>;

  /* ---------- Signalements et statistiques d'étape (§ 22) ---------- */
  abstract reportStep(huntId: number, data: { stepOrder: number; category: ReportCategory; message: string | null }): Observable<StepReport>;
  abstract huntReports(huntId: number): Observable<StepReport[]>;
  abstract catalogReports(catalogId: number): Observable<StepReport[]>;
  abstract resolveReport(reportId: number, resolved: boolean): Observable<StepReport>;
  abstract huntStats(huntId: number): Observable<HuntStats>;
  abstract catalogStats(catalogId: number): Observable<HuntStats>;

  /** Accès à la chasse sur mesure : formules, crédits, limites (§ 21). */
  abstract generationAccess(): Observable<GenerationAccess>;

  /* ---------- Assistant de rédaction (§ 25) ---------- */
  /** Décompte des suggestions : utilisées, restantes, et quand elles reviennent. */
  abstract assistUsage(): Observable<AssistUsage>;
  /** Suggestion de l'IA pour l'énigme d'une étape, d'après le texte en cours (rien n'est enregistré). */
  abstract assist(stepId: number, req: AssistRequest): Observable<AssistReply>;

  /* ---------- Paiement (§ 20) ---------- */
  /** Ouvre le paiement d'un produit (« skin:medieval », « hunt:c12 ») ; url null s'il n'y avait rien à payer. */
  abstract checkout(productId: string, returnPath: string): Observable<CheckoutResult>;
  abstract payoutAccount(): Observable<PayoutAccount>;
  /** Inscription du vendeur chez Stripe Connect : l'adresse où l'envoyer. */
  abstract startPayouts(returnPath: string): Observable<{ url: string }>;

  /* ---------- Créations de la communauté (§ 19) ---------- */
  abstract myCreations(): Observable<Creation[]>;
  abstract createCreation(data: CreationInput): Observable<Creation>;
  abstract updateCreation(id: number, data: Partial<Omit<CreationInput, 'kind'>>): Observable<Creation>;
  abstract deleteCreation(id: number): Observable<void>;
  abstract submitCreation(id: number): Observable<Creation>;
  abstract withdrawCreation(id: number): Observable<Creation>;
  abstract reviewQueue(): Observable<Creation[]>;
  abstract reviewCreation(id: number, approve: boolean, note: string | null): Observable<Creation>;
  /** Énigmes d'un pack de créateur obtenu (avec les réponses). */
  abstract packPuzzles(id: number): Observable<Puzzle[]>;
  abstract getCreator(id: number): Observable<CreatorPage>;
  /** Manifeste public d'un skin de créateur publié (« u12 »). */
  abstract creatorSkin(id: string): Observable<SkinManifest>;
  /** Outil Boussole : direction et fourchette de distance du prochain lieu. */
  abstract compass(huntId: number, pos: { lat: number; lng: number }): Observable<CompassReading>;
  /** Autour de moi (§ 45) : adresses utiles près du joueur ; `huntId` ajoute les centres d'intérêt de son équipe. */
  abstract nearby(pos: { lat: number; lng: number }, radius: number, huntId?: number): Observable<NearbyResult>;
  /** Guide (§ 46) : ce que le guide comprend de la demande du joueur. */
  abstract understand(req: GuideRequest): Observable<GuideUnderstanding>;
  /** Centres d'intérêt de l'équipe du joueur dans une chasse (§ 46). */
  abstract setInterests(huntId: number, interests: GuideInterest[]): Observable<GuideInterest[]>;

  /* Énigmes d'arrivée (§ 17) */
  abstract solvePuzzle(huntId: number, answer: string): Observable<PuzzleResult>;
  abstract puzzleHint(huntId: number): Observable<PlayState>;

  /* Preuve par photo (§ 12) : images en « data URL » JPEG, déjà réduites par le téléphone. */
  /** QR introuvable : photo du lieu, jugée par l'IA. */
  abstract submitPhoto(huntId: number, image: string): Observable<PhotoResult>;
  /** L'équipe confirme une photo que l'IA n'a pas reconnue, à ses risques. */
  abstract insistPhoto(photoId: number): Observable<PhotoResult>;
  abstract huntPhotos(huntId: number): Observable<PhotoAttempt[]>;
  abstract reviewPhoto(photoId: number, approve: boolean): Observable<PhotoAttempt[]>;
  abstract photoImage(photoId: number): Observable<Blob>;
  abstract referenceImage(stepId: number): Observable<Blob>;
  /** Photo du lieu montrée aux joueurs (§ 18). */
  abstract illustrationImage(stepId: number): Observable<Blob>;
  /** Photo de référence d'une étape ; null la retire. */
  abstract setReferencePhoto(stepId: number, image: string | null): Observable<Step>;

  /* Catalogue (§ 13) */
  /** mine : mes publications ; hunt : celles d'une de mes chasses (retirées comprises). */
  abstract listCatalog(opts?: CatalogQuery): Observable<CatalogEntry[]>;
  abstract getCatalogEntry(id: number): Observable<CatalogDetail>;
  /** Surprends-moi (§ 37) : une Secret Track jouable en autonomie, choisie pour le joueur. */
  abstract surprise(q: SurpriseQuery): Observable<Surprise>;
  /** Crée un brouillon à partir d'une version du catalogue. */
  abstract copyFromCatalog(id: number): Observable<Hunt>;
  abstract withdrawFromCatalog(id: number): Observable<CatalogDetail>;
  /** Jouer une chasse du catalogue en autonomie : la partie du joueur, à lancer sur place. */
  /** `challenge` : la partie dont on relève le défi (§ 39). */
  abstract playFromCatalog(id: number, challenge?: number): Observable<Hunt>;
  abstract autonomyLeaderboard(id: number): Observable<AutonomyLeaderboard>;
  /** Défi « bats mon temps » (§ 28) : le temps d'une partie en autonomie finie. */
  abstract getChallenge(id: number, huntId: number): Observable<Challenge>;
  /** Lancer le défi depuis sa partie finie, avec un mot (§ 39). */
  abstract setChallenge(id: number, huntId: number, message: string | null): Observable<Challenge>;
  /* ---------- Version anglaise (§ 33) ---------- */
  /** Traductions du contenu visible (partie, fiches du catalogue) : texte français → traduction. */
  abstract translate(req: { lang: 'en'; hunt?: number; catalog?: number[]; info?: number[] }): Observable<Record<string, string>>;

  /* ---------- Hors ligne (§ 32) ---------- */
  /** Paquet hors ligne : le parcours restant de l'équipe et sa progression. */
  abstract getOfflinePack(huntId: number): Observable<OfflinePack>;
  /** Rejoue les actions jouées sans réseau. */
  abstract offlineSync(huntId: number, events: OfflineEvent[]): Observable<OfflineSyncResult & { state: PlayState }>;

  /* ---------- Favoris et listes (§ 38) ---------- */
  /** Listes du joueur, « À faire » d'abord (créée d'office). */
  abstract myLists(): Observable<TrackList[]>;
  abstract getList(id: number): Observable<TrackListDetail>;
  abstract createList(name: string, icon: string): Observable<TrackList>;
  /** Renommer, changer d'icône, partager (code) ou cesser de partager. */
  abstract updateList(id: number, data: { name?: string; icon?: string; shared?: boolean }): Observable<TrackList>;
  abstract deleteList(id: number): Observable<void>;
  abstract joinList(code: string): Observable<TrackList>;
  abstract leaveList(id: number): Observable<void>;
  abstract listAdd(id: number, catalogId: number): Observable<TrackList>;
  abstract listRemove(id: number, catalogId: number): Observable<TrackList>;

  /** Parties commencées et pas finies, à reprendre (§ 35). */
  abstract getInProgress(): Observable<GameInProgress[]>;
  /** Carnet d'explorateur du joueur (§ 29). */
  abstract getJournal(): Observable<ExplorerJournal>;
  /** Souvenir de fin de partie de l'équipe du joueur (§ 24). */
  abstract getSouvenir(huntId: number): Observable<Souvenir>;
  abstract publishToCatalog(huntId: number, pub: CatalogPublication): Observable<CatalogDetail>;

  /* Notations (§ 14) */
  abstract getRating(huntId: number): Observable<RatingState>;
  abstract rateHunt(huntId: number, rating: Rating): Observable<RatingState>;
  abstract getOrganizer(id: number): Observable<OrganizerProfile>;

  abstract getResults(huntId: number): Observable<RankingRow[]>;
  abstract getLive(huntId: number): Observable<LiveRow[]>;
  abstract validateManually(teamId: number, stepId: number): Observable<LiveRow[]>;
}
