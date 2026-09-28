import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
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
  StoreItem,
  CompassReading,
  PuzzleResult,
  Souvenir,
  Challenge,
} from '@shared/models';
import { catchError, map, Observable, throwError } from 'rxjs';
import { Creation, CreationInput, CreatorPage } from '@shared/creations';
import { Puzzle } from '@shared/puzzles';
import { SkinManifest } from '@shared/skins';
import { GenerationAccess } from '@shared/generation-access';
import { AssistReply, AssistRequest, AssistUsage } from '@shared/assist';
import { environment } from '../../environments/environment';
import { ApiError, CatalogQuery, HuntAction, HuntApi, HuntScope } from './api';
import { Session } from './session';

/** Client de l'API REST (server/src/app.ts). */
@Injectable()
export class HttpHuntApi extends HuntApi {
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiUrl;

  login(email: string, password: string): Observable<AuthResult> {
    return this.http.post<AuthResult>(`${this.url}/auth/login`, { email, password });
  }
  register(nickname: string, email: string, password: string): Observable<AuthResult> {
    return this.http.post<AuthResult>(`${this.url}/auth/register`, { nickname, email, password });
  }
  logout(): Observable<void> {
    return this.http.post<void>(`${this.url}/auth/logout`, {});
  }
  updateMe(data: Partial<Pick<Hunter, 'nickname' | 'email' | 'rateable'>>): Observable<Hunter> {
    return this.http.patch<Hunter>(`${this.url}/me`, data);
  }

  listHunts(scope: HuntScope): Observable<Hunt[]> {
    return this.http.get<Hunt[]>(`${this.url}/hunts`, { params: { scope } });
  }
  getHunt(id: number): Observable<Hunt> {
    return this.http.get<Hunt>(`${this.url}/hunts/${id}`);
  }
  findHuntByCode(code: string): Observable<Hunt> {
    return this.http.get<Hunt>(`${this.url}/hunts/by-code/${encodeURIComponent(code.trim())}`);
  }
  saveHunt(data: Partial<Hunt>): Observable<Hunt> {
    const { id, ...body } = data;
    return id ? this.http.patch<Hunt>(`${this.url}/hunts/${id}`, body) : this.http.post<Hunt>(`${this.url}/hunts`, body);
  }
  huntAction(id: number, action: HuntAction): Observable<Hunt> {
    return this.http.post<Hunt>(`${this.url}/hunts/${id}/${action}`, {});
  }

  getSteps(huntId: number): Observable<Step[]> {
    return this.http.get<Step[]>(`${this.url}/hunts/${huntId}/steps`);
  }
  saveStep(step: Partial<Step> & { huntId: number }): Observable<Step> {
    const { id, huntId, order, token, answer, ...body } = step;
    return id ? this.http.patch<Step>(`${this.url}/steps/${id}`, body) : this.http.post<Step>(`${this.url}/hunts/${huntId}/steps`, body);
  }
  deleteStep(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/steps/${id}`);
  }
  reorderSteps(huntId: number, stepIds: number[]): Observable<Step[]> {
    return this.http.put<Step[]>(`${this.url}/hunts/${huntId}/steps/order`, { stepIds });
  }
  regenerateToken(stepId: number): Observable<Step> {
    return this.http.post<Step>(`${this.url}/steps/${stepId}/regenerate`, {});
  }

  getTeams(huntId: number): Observable<Team[]> {
    return this.http.get<Team[]>(`${this.url}/hunts/${huntId}/teams`);
  }
  myTeam(huntId: number): Observable<Team | null> {
    return this.http.get<Team | null>(`${this.url}/hunts/${huntId}/my-team`).pipe(map((t) => t ?? null));
  }
  createTeam(huntId: number, name: string): Observable<Team> {
    return this.http.post<Team>(`${this.url}/hunts/${huntId}/teams`, { name });
  }
  joinTeam(code: string): Observable<Team> {
    return this.http.post<Team>(`${this.url}/teams/join`, { code });
  }
  joinSolo(huntId: number): Observable<Team> {
    return this.http.post<Team>(`${this.url}/hunts/${huntId}/solo`, {});
  }
  leaveHunt(huntId: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/hunts/${huntId}/my-team`);
  }
  setStartOrder(huntId: number, teamIds: number[]): Observable<Team[]> {
    return this.http.put<Team[]>(`${this.url}/hunts/${huntId}/teams/order`, { teamIds });
  }
  delayTeam(teamId: number, minutes: number): Observable<Team> {
    return this.http.post<Team>(`${this.url}/teams/${teamId}/delay`, { minutes });
  }

  getPlay(huntId: number): Observable<PlayState> {
    return this.http.get<PlayState>(`${this.url}/hunts/${huntId}/play`);
  }
  revealHint(huntId: number): Observable<PlayState> {
    return this.http.post<PlayState>(`${this.url}/hunts/${huntId}/hints`, {});
  }
  skipStep(huntId: number): Observable<PlayState> {
    return this.http.post<PlayState>(`${this.url}/hunts/${huntId}/skip`, {});
  }
  scan(token: string): Observable<ScanResult> {
    return this.http.post<ScanResult>(`${this.url}/scan/${encodeURIComponent(token)}`, {});
  }
  checkin(huntId: number, pos: { lat: number; lng: number; accuracy: number }): Observable<CheckinResult> {
    return this.http.post<CheckinResult>(`${this.url}/hunts/${huntId}/checkin`, pos);
  }
  selfStart(huntId: number): Observable<PlayState> {
    return this.http.post<PlayState>(`${this.url}/hunts/${huntId}/self-start`, {});
  }
  setSelfPaced(huntId: number, selfPaced: boolean): Observable<Hunt> {
    return this.http.put<Hunt>(`${this.url}/hunts/${huntId}/self-paced`, { selfPaced });
  }

  listCatalog(opts: CatalogQuery = {}): Observable<CatalogEntry[]> {
    const params: Record<string, string> = {};
    if (opts.q?.trim()) params['q'] = opts.q.trim();
    if (opts.sort) params['sort'] = opts.sort;
    if (opts.mine) params['mine'] = '1';
    if (opts.hunt) params['hunt'] = String(opts.hunt);
    if (opts.travel?.length) params['travel'] = opts.travel.join(',');
    if (opts.difficulty?.length) params['difficulty'] = opts.difficulty.join(',');
    if (opts.minDuration) params['minDuration'] = String(opts.minDuration);
    if (opts.maxDuration) params['maxDuration'] = String(opts.maxDuration);
    if (opts.autonomous) params['autonomous'] = '1';
    if (opts.practical?.length) params['practical'] = opts.practical.join(',');
    if (opts.near) {
      params['lat'] = opts.near.lat.toFixed(5);
      params['lng'] = opts.near.lng.toFixed(5);
      if (opts.radius) params['radius'] = String(opts.radius);
    }
    return this.http.get<CatalogEntry[]>(`${this.url}/catalog`, { params });
  }
  getCatalogEntry(id: number): Observable<CatalogDetail> {
    return this.http.get<CatalogDetail>(`${this.url}/catalog/${id}`);
  }
  copyFromCatalog(id: number): Observable<Hunt> {
    return this.http.post<Hunt>(`${this.url}/catalog/${id}/copy`, {});
  }
  withdrawFromCatalog(id: number): Observable<CatalogDetail> {
    return this.http.delete<CatalogDetail>(`${this.url}/catalog/${id}`);
  }
  playFromCatalog(id: number): Observable<Hunt> {
    return this.http.post<Hunt>(`${this.url}/catalog/${id}/play`, {});
  }
  getSouvenir(huntId: number): Observable<Souvenir> {
    return this.http.get<Souvenir>(`${this.url}/hunts/${huntId}/souvenir`);
  }
  getChallenge(id: number, huntId: number): Observable<Challenge> {
    return this.http.get<Challenge>(`${this.url}/catalog/${id}/challenge/${huntId}`);
  }
  autonomyLeaderboard(id: number): Observable<AutonomyLeaderboard> {
    return this.http.get<AutonomyLeaderboard>(`${this.url}/catalog/${id}/leaderboard`);
  }
  publishToCatalog(huntId: number, pub: CatalogPublication): Observable<CatalogDetail> {
    return this.http.post<CatalogDetail>(`${this.url}/hunts/${huntId}/catalog`, pub);
  }
  getRating(huntId: number): Observable<RatingState> {
    return this.http.get<RatingState>(`${this.url}/hunts/${huntId}/rating`);
  }
  rateHunt(huntId: number, rating: Rating): Observable<RatingState> {
    return this.http.put<RatingState>(`${this.url}/hunts/${huntId}/rating`, rating);
  }
  getOrganizer(id: number): Observable<OrganizerProfile> {
    return this.http.get<OrganizerProfile>(`${this.url}/organizers/${id}`);
  }

  getFeatures(): Observable<Features> {
    return this.http.get<Features>(`${this.url}/features`);
  }
  getStore(): Observable<StoreItem[]> {
    return this.http.get<StoreItem[]>(`${this.url}/store`);
  }
  acquire(productId: string): Observable<StoreItem[]> {
    return this.http.post<StoreItem[]>(`${this.url}/store/${encodeURIComponent(productId)}/acquire`, {});
  }

  reportStep(huntId: number, data: { stepOrder: number; category: ReportCategory; message: string | null }): Observable<StepReport> {
    return this.http.post<StepReport>(`${this.url}/hunts/${huntId}/reports`, data);
  }
  huntReports(huntId: number): Observable<StepReport[]> {
    return this.http.get<StepReport[]>(`${this.url}/hunts/${huntId}/reports`);
  }
  catalogReports(catalogId: number): Observable<StepReport[]> {
    return this.http.get<StepReport[]>(`${this.url}/catalog/${catalogId}/reports`);
  }
  resolveReport(reportId: number, resolved: boolean): Observable<StepReport> {
    return this.http.post<StepReport>(`${this.url}/reports/${reportId}/resolve`, { resolved });
  }
  huntStats(huntId: number): Observable<HuntStats> {
    return this.http.get<HuntStats>(`${this.url}/hunts/${huntId}/stats`);
  }
  catalogStats(catalogId: number): Observable<HuntStats> {
    return this.http.get<HuntStats>(`${this.url}/catalog/${catalogId}/stats`);
  }
  generationAccess(): Observable<GenerationAccess> {
    return this.http.get<GenerationAccess>(`${this.url}/generation/access`);
  }
  assistUsage(): Observable<AssistUsage> {
    return this.http.get<AssistUsage>(`${this.url}/assist/usage`);
  }
  assist(stepId: number, req: AssistRequest): Observable<AssistReply> {
    return this.http.post<AssistReply>(`${this.url}/steps/${stepId}/assist`, req);
  }
  checkout(productId: string, returnPath: string): Observable<CheckoutResult> {
    return this.http.post<CheckoutResult>(`${this.url}/store/${encodeURIComponent(productId)}/checkout`, { returnPath });
  }
  payoutAccount(): Observable<PayoutAccount> {
    return this.http.get<PayoutAccount>(`${this.url}/payments/account`);
  }
  startPayouts(returnPath: string): Observable<{ url: string }> {
    return this.http.post<{ url: string }>(`${this.url}/payments/account`, { returnPath });
  }

  myCreations(): Observable<Creation[]> {
    return this.http.get<Creation[]>(`${this.url}/creations/mine`);
  }
  createCreation(data: CreationInput): Observable<Creation> {
    return this.http.post<Creation>(`${this.url}/creations`, data);
  }
  updateCreation(id: number, data: Partial<Omit<CreationInput, 'kind'>>): Observable<Creation> {
    return this.http.patch<Creation>(`${this.url}/creations/${id}`, data);
  }
  deleteCreation(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/creations/${id}`);
  }
  submitCreation(id: number): Observable<Creation> {
    return this.http.post<Creation>(`${this.url}/creations/${id}/submit`, {});
  }
  withdrawCreation(id: number): Observable<Creation> {
    return this.http.post<Creation>(`${this.url}/creations/${id}/withdraw`, {});
  }
  reviewQueue(): Observable<Creation[]> {
    return this.http.get<Creation[]>(`${this.url}/creations/review`);
  }
  reviewCreation(id: number, approve: boolean, note: string | null): Observable<Creation> {
    return this.http.post<Creation>(`${this.url}/creations/${id}/review`, { approve, note });
  }
  packPuzzles(id: number): Observable<Puzzle[]> {
    return this.http.get<Puzzle[]>(`${this.url}/creations/${id}/puzzles`);
  }
  getCreator(id: number): Observable<CreatorPage> {
    return this.http.get<CreatorPage>(`${this.url}/creators/${id}`);
  }
  creatorSkin(id: string): Observable<SkinManifest> {
    return this.http.get<SkinManifest>(`${this.url}/skins/${encodeURIComponent(id)}`);
  }
  compass(huntId: number, pos: { lat: number; lng: number }): Observable<CompassReading> {
    return this.http.post<CompassReading>(`${this.url}/hunts/${huntId}/compass`, pos);
  }
  solvePuzzle(huntId: number, answer: string): Observable<PuzzleResult> {
    return this.http.post<PuzzleResult>(`${this.url}/hunts/${huntId}/puzzle`, { answer });
  }
  puzzleHint(huntId: number): Observable<PlayState> {
    return this.http.post<PlayState>(`${this.url}/hunts/${huntId}/puzzle/hint`, {});
  }
  submitPhoto(huntId: number, image: string): Observable<PhotoResult> {
    return this.http.post<PhotoResult>(`${this.url}/hunts/${huntId}/photos`, { image });
  }
  insistPhoto(photoId: number): Observable<PhotoResult> {
    return this.http.post<PhotoResult>(`${this.url}/photos/${photoId}/insist`, {});
  }
  huntPhotos(huntId: number): Observable<PhotoAttempt[]> {
    return this.http.get<PhotoAttempt[]>(`${this.url}/hunts/${huntId}/photos`);
  }
  reviewPhoto(photoId: number, approve: boolean): Observable<PhotoAttempt[]> {
    return this.http.post<PhotoAttempt[]>(`${this.url}/photos/${photoId}/review`, { approve });
  }
  photoImage(photoId: number): Observable<Blob> {
    return this.http.get(`${this.url}/photos/${photoId}/image`, { responseType: 'blob' });
  }
  referenceImage(stepId: number): Observable<Blob> {
    return this.http.get(`${this.url}/steps/${stepId}/reference-photo`, { responseType: 'blob' });
  }
  illustrationImage(stepId: number): Observable<Blob> {
    return this.http.get(`${this.url}/steps/${stepId}/illustration`, { responseType: 'blob' });
  }
  setReferencePhoto(stepId: number, image: string | null): Observable<Step> {
    const url = `${this.url}/steps/${stepId}/reference-photo`;
    return image === null ? this.http.delete<Step>(url) : this.http.put<Step>(url, { image });
  }

  generateHunt(request: GenerationRequest): Observable<GenerationJob> {
    return this.http.post<GenerationJob>(`${this.url}/hunts/generate`, request);
  }
  getGeneration(id: string): Observable<GenerationJob> {
    return this.http.get<GenerationJob>(`${this.url}/generations/${encodeURIComponent(id)}`);
  }

  getResults(huntId: number): Observable<RankingRow[]> {
    return this.http.get<RankingRow[]>(`${this.url}/hunts/${huntId}/results`);
  }
  getLive(huntId: number): Observable<LiveRow[]> {
    return this.http.get<LiveRow[]>(`${this.url}/hunts/${huntId}/live`);
  }
  validateManually(teamId: number, stepId: number): Observable<LiveRow[]> {
    return this.http.post<LiveRow[]>(`${this.url}/teams/${teamId}/validations`, { stepId });
  }
}

/**
 * Ajoute le jeton de session aux appels de l'API et traduit les erreurs en ApiError (message lisible).
 * Un 401 sur un jeton existant signifie une session expirée : on se déconnecte localement.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);
  const session = inject(Session);
  const token = session.token();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && token) session.set(null);
      const message =
        (err.error as { message?: string } | null)?.message ??
        (err.status === 0 ? 'Serveur injoignable : vérifiez votre connexion.' : 'Une erreur est survenue.');
      return throwError(() => new ApiError(message));
    }),
  );
};
