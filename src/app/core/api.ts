import { Observable } from 'rxjs';
import {
  AuthResult,
  CheckinResult,
  GenerationJob,
  GenerationRequest,
  Hunt,
  Hunter,
  LiveRow,
  PlayState,
  RankingRow,
  ScanResult,
  Step,
  Team,
} from '@shared/models';

export type HuntScope = 'public' | 'playing' | 'organized';
export type HuntAction = 'publish' | 'unpublish' | 'start' | 'close' | 'cancel';

export class ApiError extends Error {}

/**
 * Contrat entre le front et le back-end (docs/conception.md § 7).
 * Implémenté par MockHuntApi pour les maquettes, puis par un client HTTP.
 */
export abstract class HuntApi {
  abstract login(email: string, password: string): Observable<AuthResult>;
  abstract register(nickname: string, email: string, password: string): Observable<AuthResult>;
  abstract logout(): Observable<void>;
  abstract updateMe(data: Partial<Pick<Hunter, 'nickname' | 'email'>>): Observable<Hunter>;

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
  /** Chasse surprise : le joueur donne lui-même le départ. */
  abstract selfStart(huntId: number): Observable<PlayState>;

  /** Demande l'invention d'une chasse (OpenStreetMap + IA) ; suivie avec getGeneration. */
  abstract generateHunt(request: GenerationRequest): Observable<GenerationJob>;
  abstract getGeneration(id: string): Observable<GenerationJob>;

  abstract getResults(huntId: number): Observable<RankingRow[]>;
  abstract getLive(huntId: number): Observable<LiveRow[]>;
  abstract validateManually(teamId: number, stepId: number): Observable<LiveRow[]>;
}
