import { inject, Injectable } from '@angular/core';
import { defer, delay, Observable, of, throwError } from 'rxjs';
import { ApiError, HuntAction, HuntApi, HuntScope } from '../api';
import { AuthResult, Hunt, Hunter, LiveRow, PlayClue, PlayState, RankingRow, ScanResult, Step, Team } from '@shared/models';
import { computeRanking, evaluateScan, finalOrder, hintPenaltyMinutes, lastValidatedOrder, randomToken, teamPosition, teamStartTimes } from '@shared/rules';
import { Session } from '../session';
import { buildFixtures, MockDb } from '@shared/fixtures';

const LATENCY_MS = 150;

/**
 * Back-end simulé en mémoire pour les maquettes. Il applique les règles de docs/conception.md
 * comme le ferait le serveur. Les données sont réinitialisées à chaque rechargement de page.
 */
@Injectable()
export class MockHuntApi extends HuntApi {
  private readonly session = inject(Session);
  private readonly db: MockDb = buildFixtures();

  logout(): Observable<void> {
    return this.reply(() => undefined);
  }

  /* ---------- Comptes ---------- */

  login(email: string, password: string): Observable<AuthResult> {
    return this.reply(() => {
      const h = this.db.hunters.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!h || h.password !== password) throw new ApiError('E-mail ou mot de passe incorrect.');
      return { user: this.publicHunter(h), token: `mock-${h.id}` };
    });
  }

  register(nickname: string, email: string, password: string): Observable<AuthResult> {
    return this.reply(() => {
      if (this.db.hunters.some((h) => h.email.toLowerCase() === email.toLowerCase())) throw new ApiError('Cet e-mail est déjà utilisé.');
      if (this.db.hunters.some((h) => h.nickname.toLowerCase() === nickname.toLowerCase())) throw new ApiError('Ce pseudo est déjà pris.');
      const h = { id: this.nextId(this.db.hunters), nickname, email, password };
      this.db.hunters.push(h);
      return { user: this.publicHunter(h), token: `mock-${h.id}` };
    });
  }

  updateMe(data: Partial<Pick<Hunter, 'nickname' | 'email'>>): Observable<Hunter> {
    return this.reply(() => {
      const me = this.db.hunters.find((h) => h.id === this.requireUser())!;
      Object.assign(me, data);
      this.db.teams.forEach((t) => t.members.forEach((m) => m.hunterId === me.id && (m.nickname = me.nickname)));
      return this.publicHunter(me);
    });
  }

  /* ---------- Chasses ---------- */

  listHunts(scope: HuntScope): Observable<Hunt[]> {
    return this.reply(() => {
      const me = this.viewer();
      let list = this.db.hunts;
      if (scope === 'public') list = list.filter((h) => h.isPublic && ['published', 'running', 'closed'].includes(h.status));
      if (scope === 'playing') list = list.filter((h) => this.teamOf(h.id, me) !== null);
      if (scope === 'organized') list = list.filter((h) => h.ownerId === me);
      return list.map((h) => this.huntView(h)).sort((a, b) => a.begin.localeCompare(b.begin));
    });
  }

  getHunt(id: number): Observable<Hunt> {
    return this.reply(() => this.huntView(this.visibleHunt(id)));
  }

  findHuntByCode(code: string): Observable<Hunt> {
    return this.reply(() => {
      const h = this.db.hunts.find((x) => x.joinCode.toUpperCase() === code.trim().toUpperCase() && x.status !== 'draft');
      if (h) return this.huntView(h);
      const team = this.db.teams.find((t) => t.joinCode.toUpperCase() === code.trim().toUpperCase());
      if (team) return this.huntView(this.visibleHunt(team.huntId));
      throw new ApiError('Aucune chasse ni équipe ne correspond à ce code.');
    });
  }

  saveHunt(data: Partial<Hunt>): Observable<Hunt> {
    return this.reply(() => {
      const me = this.requireUser();
      if (data.id) {
        const h = this.ownedHunt(data.id);
        const { id, ownerId, status, started, closed, ...editable } = data;
        Object.assign(h, editable);
        return this.huntView(h);
      }
      const id = this.nextId(this.db.hunts);
      const h: MockDb['hunts'][number] = {
        name: 'Nouvelle chasse',
        description: '',
        location: '',
        begin: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        end: new Date(Date.now() + 7 * 86_400_000 + 3 * 3_600_000).toISOString(),
        autoStart: false,
        autoClose: false,
        award: null,
        startMode: 'mass',
        interval: null,
        hintPenalties: [0, 0, 0],
        teamGame: true,
        teamMin: 1,
        teamMax: 4,
        isPublic: true,
        contribution: 0,
        startText: null,
        ...data,
        id,
        ownerId: me,
        joinCode: randomToken(6).toUpperCase(),
        status: 'draft',
        started: null,
        closed: null,
      };
      this.db.hunts.push(h);
      // Toute chasse commence avec un départ et une arrivée.
      this.db.steps.push(this.blankStep(id, 0, 'Départ'));
      this.db.steps.push(this.blankStep(id, 1, 'Arrivée'));
      return this.huntView(h);
    });
  }

  huntAction(id: number, action: HuntAction): Observable<Hunt> {
    return this.reply(() => {
      const h = this.ownedHunt(id);
      const now = new Date().toISOString();
      const expect = (...statuses: Hunt['status'][]) => {
        if (!statuses.includes(h.status)) throw new ApiError('Action impossible dans l’état actuel de la chasse.');
      };
      switch (action) {
        case 'publish':
          expect('draft');
          if (finalOrder(this.stepsOf(id)) < 1) throw new ApiError('Ajoutez au moins une étape avant de publier.');
          h.status = 'published';
          break;
        case 'unpublish':
          expect('published');
          if (this.db.teams.some((t) => t.huntId === id)) throw new ApiError('Des équipes sont déjà inscrites.');
          h.status = 'draft';
          break;
        case 'start': {
          expect('published');
          h.status = 'running';
          h.started = now;
          const teams = this.db.teams.filter((t) => t.huntId === id);
          const starts = teamStartTimes(h, teams, now);
          teams.forEach((t) => (t.started = starts.get(t.id) ?? null));
          break;
        }
        case 'close':
          expect('running');
          h.status = 'closed';
          h.closed = now;
          break;
        case 'cancel':
          expect('draft', 'published', 'running');
          h.status = 'cancelled';
          break;
      }
      return this.huntView(h);
    });
  }

  /* ---------- Étapes ---------- */

  getSteps(huntId: number): Observable<Step[]> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      return this.stepsOf(huntId);
    });
  }

  saveStep(step: Partial<Step> & { huntId: number }): Observable<Step> {
    return this.reply(() => {
      this.ownedHunt(step.huntId);
      if (step.id) {
        const s = this.db.steps.find((x) => x.id === step.id && x.huntId === step.huntId);
        if (!s) throw new ApiError('Étape introuvable.');
        const { id, huntId, order, token, ...editable } = step;
        Object.assign(s, editable);
        return s;
      }
      // Une nouvelle étape s'insère juste avant l'arrivée.
      const steps = this.stepsOf(step.huntId);
      const arrival = steps[steps.length - 1];
      const s: Step = { ...this.blankStep(step.huntId, arrival.order, `Étape ${arrival.order}`), ...step };
      s.order = arrival.order;
      arrival.order++;
      this.db.steps.push(s);
      return s;
    });
  }

  deleteStep(id: number): Observable<void> {
    return this.reply(() => {
      const s = this.db.steps.find((x) => x.id === id);
      if (!s) throw new ApiError('Étape introuvable.');
      this.ownedHunt(s.huntId);
      const final = finalOrder(this.stepsOf(s.huntId));
      if (s.order === 0 || s.order === final) throw new ApiError('Le départ et l’arrivée ne peuvent pas être supprimés.');
      this.db.steps = this.db.steps.filter((x) => x.id !== id);
      this.stepsOf(s.huntId).forEach((x, i) => (x.order = i));
    });
  }

  reorderSteps(huntId: number, stepIds: number[]): Observable<Step[]> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      const steps = this.stepsOf(huntId);
      const middle = steps.slice(1, -1);
      if (stepIds.length !== middle.length || !middle.every((s) => stepIds.includes(s.id))) {
        throw new ApiError('Liste d’étapes invalide.');
      }
      stepIds.forEach((sid, i) => (this.db.steps.find((s) => s.id === sid)!.order = i + 1));
      steps[steps.length - 1].order = stepIds.length + 1;
      return this.stepsOf(huntId);
    });
  }

  regenerateToken(stepId: number): Observable<Step> {
    return this.reply(() => {
      const s = this.db.steps.find((x) => x.id === stepId);
      if (!s || s.order === 0) throw new ApiError('Étape introuvable.');
      this.ownedHunt(s.huntId);
      s.token = randomToken();
      return s;
    });
  }

  /* ---------- Équipes ---------- */

  getTeams(huntId: number): Observable<Team[]> {
    return this.reply(() => {
      this.visibleHunt(huntId);
      return this.db.teams.filter((t) => t.huntId === huntId).sort((a, b) => (a.startOrder ?? 999) - (b.startOrder ?? 999) || a.id - b.id);
    });
  }

  myTeam(huntId: number): Observable<Team | null> {
    return this.reply(() => this.teamOf(huntId, this.viewer()));
  }

  createTeam(huntId: number, name: string): Observable<Team> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.joinableHunt(huntId, me);
      if (!h.teamGame) throw new ApiError('Cette chasse se joue en solo.');
      if (this.db.teams.some((t) => t.huntId === huntId && t.name.toLowerCase() === name.trim().toLowerCase())) {
        throw new ApiError('Une équipe porte déjà ce nom.');
      }
      return this.addTeam(h, name.trim(), me, false);
    });
  }

  joinTeam(code: string): Observable<Team> {
    return this.reply(() => {
      const me = this.requireUser();
      const team = this.db.teams.find((t) => t.joinCode.toUpperCase() === code.trim().toUpperCase());
      if (!team) throw new ApiError('Code d’équipe inconnu.');
      const h = this.joinableHunt(team.huntId, me);
      if (team.members.length >= h.teamMax) throw new ApiError('Cette équipe est complète.');
      team.members.push({ hunterId: me, nickname: this.nick(me) });
      return team;
    });
  }

  joinSolo(huntId: number): Observable<Team> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.joinableHunt(huntId, me);
      if (h.teamGame) throw new ApiError('Cette chasse se joue en équipe.');
      return this.addTeam(h, this.nick(me), me, true);
    });
  }

  leaveHunt(huntId: number): Observable<void> {
    return this.reply(() => {
      const me = this.requireUser();
      const team = this.teamOf(huntId, me);
      if (!team) return;
      if (this.db.hunts.find((h) => h.id === huntId)!.status !== 'published') throw new ApiError('La chasse a déjà commencé.');
      team.members = team.members.filter((m) => m.hunterId !== me);
      if (team.members.length === 0) this.db.teams = this.db.teams.filter((t) => t.id !== team.id);
      else if (team.ownerId === me) team.ownerId = team.members[0].hunterId;
    });
  }

  setStartOrder(huntId: number, teamIds: number[]): Observable<Team[]> {
    return this.reply(() => {
      const h = this.ownedHunt(huntId);
      if (h.status !== 'published') throw new ApiError('L’ordre de passage se fixe avant le déclenchement.');
      teamIds.forEach((id, i) => {
        const t = this.db.teams.find((x) => x.id === id && x.huntId === huntId);
        if (t) t.startOrder = i + 1;
      });
      return this.db.teams.filter((t) => t.huntId === huntId).sort((a, b) => (a.startOrder ?? 999) - (b.startOrder ?? 999));
    });
  }

  delayTeam(teamId: number, minutes: number): Observable<Team> {
    return this.reply(() => {
      const t = this.db.teams.find((x) => x.id === teamId);
      if (!t) throw new ApiError('Équipe introuvable.');
      const h = this.ownedHunt(t.huntId);
      if (h.status !== 'running' || !t.started) throw new ApiError('La chasse n’est pas en cours.');
      const shifted = Date.parse(t.started) + minutes * 60_000;
      t.started = new Date(Math.max(shifted, Date.parse(h.started!))).toISOString();
      return t;
    });
  }

  /* ---------- Jeu ---------- */

  getPlay(huntId: number): Observable<PlayState> {
    return this.reply(() => this.playState(huntId));
  }

  revealHint(huntId: number): Observable<PlayState> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.playState(huntId);
      const clue = state.clue;
      if (!clue) throw new ApiError('Aucune énigme en cours.');
      if (clue.hintsRevealed.length >= clue.hintsTotal) throw new ApiError('Tous les jokers sont déjà dévoilés.');
      this.db.hintUses.push({
        teamId: state.team.id,
        stepId: clue.stepId,
        level: clue.hintsRevealed.length + 1,
        hunterId: me,
        at: new Date().toISOString(),
      });
      return this.playState(huntId);
    });
  }

  scan(token: string): Observable<ScanResult> {
    return this.reply(() => {
      const step = this.db.steps.find((s) => s.token === token) ?? null;
      const rawHunt = step ? this.db.hunts.find((h) => h.id === step.huntId)! : null;
      const me = this.viewer();
      const team = rawHunt ? this.teamOf(rawHunt.id, me) : null;
      const steps = rawHunt ? this.stepsOf(rawHunt.id) : [];
      const validations = team ? this.db.validations.filter((v) => v.teamId === team.id) : [];
      const outcome = evaluateScan({ hunt: rawHunt ? this.huntView(rawHunt) : null, steps, step, viewerId: me, team, validations, now: Date.now() });

      const result: ScanResult = { outcome, hunt: null, step: null, next: null, team, podium: null };
      if (outcome === 'unknown') return result;
      result.hunt = this.huntView(rawHunt!);
      const final = finalOrder(steps);
      const stepInfo = { order: step!.order, title: step!.title, arrival: step!.arrival, isFinal: step!.order === final };

      if (outcome === 'validated') {
        this.db.validations.push({ teamId: team!.id, stepId: step!.id, hunterId: me!, source: 'QR', at: new Date().toISOString() });
        if (step!.order === final) team!.finished = new Date().toISOString();
      }
      if (outcome === 'organizer') {
        result.step = stepInfo;
        result.next = step!.instructions
          ? { stepId: step!.id, targetOrder: step!.order + 1, instructions: step!.instructions, hintsRevealed: step!.hints, hintsTotal: step!.hints.length }
          : null;
      }
      if (outcome === 'validated' || outcome === 'already_validated') {
        result.step = stepInfo;
        result.next = this.playState(rawHunt!.id).clue;
      }
      if (outcome === 'closed') result.podium = this.ranking(rawHunt!.id).slice(0, 3);
      return result;
    });
  }

  /* ---------- Résultats et pilotage ---------- */

  getResults(huntId: number): Observable<RankingRow[]> {
    return this.reply(() => {
      const h = this.visibleHunt(huntId);
      const me = this.viewer();
      const ended = h.status === 'closed' || h.status === 'archived';
      if (!ended && h.ownerId !== me) throw new ApiError('Les résultats seront publiés à la clôture de la chasse.');
      return this.ranking(huntId);
    });
  }

  getLive(huntId: number): Observable<LiveRow[]> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      return this.liveRows(huntId);
    });
  }

  validateManually(teamId: number, stepId: number): Observable<LiveRow[]> {
    return this.reply(() => {
      const t = this.db.teams.find((x) => x.id === teamId);
      if (!t) throw new ApiError('Équipe introuvable.');
      const h = this.ownedHunt(t.huntId);
      const steps = this.stepsOf(h.id);
      const step = steps.find((s) => s.id === stepId);
      if (!step) throw new ApiError('Étape introuvable.');
      const vals = this.db.validations.filter((v) => v.teamId === teamId);
      if (step.order !== lastValidatedOrder(steps, vals) + 1) throw new ApiError('Seule l’étape suivante de l’équipe peut être validée.');
      const now = new Date().toISOString();
      this.db.validations.push({ teamId, stepId, hunterId: t.ownerId, source: 'MANUAL', at: now });
      if (step.order === finalOrder(steps)) t.finished = now;
      return this.liveRows(h.id);
    });
  }

  /* ---------- Outils internes ---------- */

  private reply<T>(fn: () => T): Observable<T> {
    return defer(() => {
      try {
        return of(structuredClone(fn()));
      } catch (e) {
        return throwError(() => e);
      }
    }).pipe(delay(LATENCY_MS));
  }

  private viewer(): number | null {
    return this.session.user()?.id ?? null;
  }

  private requireUser(): number {
    const me = this.viewer();
    if (me === null) throw new ApiError('Connectez-vous pour continuer.');
    return me;
  }

  private visibleHunt(id: number) {
    const h = this.db.hunts.find((x) => x.id === id);
    if (!h || (h.status === 'draft' && h.ownerId !== this.viewer())) throw new ApiError('Chasse introuvable.');
    return h;
  }

  private ownedHunt(id: number) {
    const h = this.visibleHunt(id);
    if (h.ownerId !== this.requireUser()) throw new ApiError('Réservé à l’organisateur de la chasse.');
    return h;
  }

  private joinableHunt(huntId: number, me: number) {
    const h = this.visibleHunt(huntId);
    if (h.status !== 'published') throw new ApiError('Les inscriptions sont fermées.');
    if (h.ownerId === me) throw new ApiError('Vous organisez cette chasse.');
    if (this.teamOf(huntId, me)) throw new ApiError('Vous êtes déjà inscrit à cette chasse.');
    return h;
  }

  private huntView(h: MockDb['hunts'][number]): Hunt {
    return {
      ...h,
      ownerNickname: this.nick(h.ownerId),
      stepCount: finalOrder(this.stepsOf(h.id)),
      teamCount: this.db.teams.filter((t) => t.huntId === h.id).length,
    };
  }

  private stepsOf(huntId: number): Step[] {
    return this.db.steps.filter((s) => s.huntId === huntId).sort((a, b) => a.order - b.order);
  }

  private teamOf(huntId: number, hunterId: number | null): Team | null {
    if (hunterId === null) return null;
    return this.db.teams.find((t) => t.huntId === huntId && t.members.some((m) => m.hunterId === hunterId)) ?? null;
  }

  private addTeam(h: MockDb['hunts'][number], name: string, owner: number, solo: boolean): Team {
    const team: Team = {
      id: this.nextId(this.db.teams),
      huntId: h.id,
      name,
      ownerId: owner,
      joinCode: randomToken(6).toUpperCase(),
      solo,
      startOrder: null,
      started: null,
      finished: null,
      members: [{ hunterId: owner, nickname: this.nick(owner) }],
    };
    this.db.teams.push(team);
    return team;
  }

  private playState(huntId: number): PlayState {
    const me = this.requireUser();
    const hunt = this.huntView(this.visibleHunt(huntId));
    const team = this.teamOf(huntId, me);
    if (!team) throw new ApiError('Vous n’êtes pas inscrit à cette chasse.');
    const steps = this.stepsOf(huntId);
    const vals = this.db.validations.filter((v) => v.teamId === team.id);
    const validated = vals
      .map((v) => {
        const s = steps.find((x) => x.id === v.stepId)!;
        return { order: s.order, title: s.title, arrival: s.arrival, at: v.at };
      })
      .sort((a, b) => a.order - b.order);
    const hints = this.db.hintUses.filter((u) => u.teamId === team.id);

    let clue: PlayClue | null = null;
    const started = team.started !== null && Date.parse(team.started) <= Date.now();
    if (hunt.status === 'running' && started && !team.finished) {
      const current = steps.find((s) => s.order === lastValidatedOrder(steps, vals))!;
      const revealed = hints.filter((u) => u.stepId === current.id).sort((a, b) => a.level - b.level);
      clue = {
        stepId: current.id,
        targetOrder: current.order + 1,
        instructions: current.instructions ?? '',
        hintsRevealed: revealed.map((u) => current.hints[u.level - 1]),
        hintsTotal: current.hints.length,
      };
    }
    const position = hunt.status === 'running' && team.started ? teamPosition(this.ranking(huntId), team.id) : null;
    return {
      hunt,
      team,
      totalSteps: finalOrder(steps),
      validated,
      clue,
      hintsUsed: hints.length,
      penalty: hintPenaltyMinutes(hunt, hints),
      position,
    };
  }

  private ranking(huntId: number): RankingRow[] {
    const h = this.db.hunts.find((x) => x.id === huntId)!;
    const teams = this.db.teams.filter((t) => t.huntId === huntId);
    const ids = new Set(teams.map((t) => t.id));
    return computeRanking(
      h,
      teams,
      this.db.validations.filter((v) => ids.has(v.teamId)),
      this.db.hintUses.filter((u) => ids.has(u.teamId)),
    );
  }

  private liveRows(huntId: number): LiveRow[] {
    const steps = this.stepsOf(huntId);
    const now = Date.now();
    return this.db.teams
      .filter((t) => t.huntId === huntId)
      .map((team) => {
        const vals = this.db.validations.filter((v) => v.teamId === team.id);
        const status: LiveRow['status'] = team.finished ? 'finished' : team.started && Date.parse(team.started) <= now ? 'running' : 'waiting';
        return {
          team,
          lastOrder: lastValidatedOrder(steps, vals),
          lastAt: vals.map((v) => v.at).sort().at(-1) ?? null,
          hints: this.db.hintUses.filter((u) => u.teamId === team.id).length,
          status,
        };
      })
      .sort((a, b) => (a.team.startOrder ?? 999) - (b.team.startOrder ?? 999) || a.team.id - b.team.id);
  }

  private blankStep(huntId: number, order: number, title: string): Step {
    return {
      id: this.nextId(this.db.steps),
      huntId,
      order,
      token: order === 0 ? null : randomToken(),
      title,
      arrival: null,
      instructions: null,
      hints: [],
      answer: null,
      latitude: null,
      longitude: null,
      address: null,
    };
  }

  private nick(id: number): string {
    return this.db.hunters.find((h) => h.id === id)?.nickname ?? '?';
  }

  private publicHunter(h: Hunter): Hunter {
    return { id: h.id, nickname: h.nickname, email: h.email };
  }

  private nextId(list: { id: number }[]): number {
    return list.reduce((max, x) => Math.max(max, x.id), 0) + 1;
  }
}
