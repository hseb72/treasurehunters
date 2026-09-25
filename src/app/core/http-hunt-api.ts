import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AuthResult, CheckinResult, GenerationJob, GenerationRequest, Hunt, Hunter, LiveRow, PlayState, RankingRow, ScanResult, Step, Team } from '@shared/models';
import { catchError, map, Observable, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiError, HuntAction, HuntApi, HuntScope } from './api';
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
  updateMe(data: Partial<Pick<Hunter, 'nickname' | 'email'>>): Observable<Hunter> {
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
