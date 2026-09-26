import { inject, Injectable } from '@angular/core';
import { defer, delay, Observable, of, throwError } from 'rxjs';
import { ApiError, CatalogQuery, HuntAction, HuntApi, HuntScope } from '../api';
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
  PhotoReview,
  PlayClue,
  PlayState,
  RankingRow,
  Rating,
  RatingState,
  ScanResult,
  Step,
  Team,
} from '@shared/models';
import { demoPlan, plannedStepCount } from '@shared/generation';
import {
  checkinAllowance,
  computeRanking,
  distanceMeters,
  evaluateScan,
  finalOrder,
  lastValidatedOrder,
  penaltyMinutes,
  randomToken,
  teamPosition,
  teamStartTimes,
} from '@shared/rules';
import { Session } from '../session';
import { buildFixtures, MockDb } from '@shared/fixtures';

const LATENCY_MS = 150;
/** Durée simulée d'une génération de chasse. */
const GENERATION_MS = 4000;
/** Compte « Treasure Hunters », organisateur des chasses surprises. */
const SYSTEM_ID = 999;
/** Lieu par défaut quand le lieu est donné par son nom (pas de géocodage en maquette). */
const MONTPELLIER = { lat: 43.6085, lng: 3.8795 };

/**
 * Back-end simulé en mémoire pour les maquettes. Il applique les règles de docs/conception.md
 * comme le ferait le serveur. Les données sont réinitialisées à chaque rechargement de page.
 */
@Injectable()
export class MockHuntApi extends HuntApi {
  private readonly session = inject(Session);
  private readonly db: MockDb = buildFixtures();
  private readonly jobs = new Map<string, GenerationJob & { readyAt: number; ownerId: number }>();
  /** Preuve par photo : images en « data URL », gardées en mémoire. */
  private readonly photos: MockPhoto[] = [];
  private readonly refPhotos = new Map<number, string>();
  /** Catalogue (§ 13) et avis (§ 14). */
  private readonly catalog: MockEntry[] = [];
  private readonly ratings: { huntId: number; hunterId: number; rating: Rating; at: string }[] = [];

  constructor() {
    super();
    this.seedCatalog();
  }

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
      const h = { id: this.nextId(this.db.hunters), nickname, email, password, rateable: false };
      this.db.hunters.push(h);
      return { user: this.publicHunter(h), token: `mock-${h.id}` };
    });
  }

  updateMe(data: Partial<Pick<Hunter, 'nickname' | 'email' | 'rateable'>>): Observable<Hunter> {
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
        const { id, ownerId, status, started, closed, hostId, hostNickname, selfPaced, catalogId, ...editable } = data;
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
        skipPenalty: 30,
        validation: 'qr',
        geoRadius: 40,
        teamGame: true,
        teamMin: 1,
        teamMax: 4,
        isPublic: true,
        contribution: 0,
        startText: null,
        ...data,
        generated: false,
        surprise: false,
        hostId: null,
        selfPaced: true,
        catalogId: null,
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
          if (h.validation === 'geo') {
            const missing = this.stepsOf(id).find((s) => s.order > 0 && (s.latitude === null || s.longitude === null));
            if (missing) throw new ApiError(`Validation par géolocalisation : placez sur la carte « ${missing.title} ».`);
          }
          h.status = 'published';
          break;
        case 'unpublish':
          expect('published');
          if (this.db.teams.some((t) => t.huntId === id)) throw new ApiError('Des équipes sont déjà inscrites.');
          h.status = 'draft';
          break;
        case 'start':
          expect('published');
          this.start(h);
          break;
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
      if (team.finished) throw new ApiError('Cette équipe a déjà terminé l’expédition.');
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
      const h = this.db.hunts.find((x) => x.id === huntId)!;
      if (h.surprise && h.hostId === me) throw new ApiError('Vous avez créé cette expédition : vous ne pouvez pas la quitter.');
      if (h.status !== 'published' && !(openToLateTeams(h) && !team.started)) throw new ApiError('La chasse a déjà commencé.');
      team.members = team.members.filter((m) => m.hunterId !== me);
      if (team.members.length === 0) this.db.teams = this.db.teams.filter((t) => t.id !== team.id);
      else if (team.ownerId === me) team.ownerId = team.members[0].hunterId;
      if (h.status === 'running') this.closeSurpriseIfAllArrived(h);
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

  skipStep(huntId: number): Observable<PlayState> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.playState(huntId);
      const clue = state.clue;
      if (!clue) throw new ApiError('Aucune épreuve en cours.');
      if (!clue.canSkip) throw new ApiError('L’arrivée ne peut pas être abandonnée : il faut trouver le trésor.');
      const target = this.stepsOf(huntId).find((s) => s.order === clue.targetOrder)!;
      this.db.validations.push({ teamId: state.team.id, stepId: target.id, hunterId: me, source: 'SKIP', at: new Date().toISOString() });
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
          ? {
              stepId: step!.id,
              targetOrder: step!.order + 1,
              instructions: step!.instructions,
              hintsRevealed: step!.hints,
              hintsTotal: step!.hints.length,
              canSkip: step!.order + 1 < final,
            }
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

  checkin(huntId: number, pos: { lat: number; lng: number; accuracy: number }): Observable<CheckinResult> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.visibleHunt(huntId);
      if (h.validation !== 'geo') throw new ApiError('Cette chasse se joue avec les QR codes posés sur place.');
      const state = this.playState(huntId);
      const clue = state.clue;
      if (!clue) throw new ApiError('Aucune étape à trouver pour le moment.');
      const steps = this.stepsOf(huntId);
      const target = steps.find((s) => s.order === clue.targetOrder)!;
      if (target.latitude === null || target.longitude === null) throw new ApiError('Ce lieu n’est pas placé sur la carte : prévenez l’organisateur.');
      const distance = Math.round(distanceMeters(pos, { lat: target.latitude, lng: target.longitude }));
      const allowed = Math.round(checkinAllowance(h, pos.accuracy));
      if (distance > allowed) return { outcome: 'too_far', distance, allowed, step: null, state } satisfies CheckinResult;
      const now = new Date().toISOString();
      const final = finalOrder(steps);
      this.db.validations.push({ teamId: state.team.id, stepId: target.id, hunterId: me, source: 'GEO', at: now });
      if (target.order === final) {
        this.db.teams.find((t) => t.id === state.team.id)!.finished = now;
        this.closeSurpriseIfAllArrived(h);
      }
      return {
        outcome: 'validated',
        distance,
        allowed,
        step: { order: target.order, title: target.title, arrival: target.arrival, isFinal: target.order === final },
        state: this.playState(huntId),
      } satisfies CheckinResult;
    });
  }

  selfStart(huntId: number): Observable<PlayState> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.visibleHunt(huntId);
      const team = this.teamOf(huntId, me);
      if (!team) throw new ApiError('Chasse introuvable.');
      if (!h.surprise) throw new ApiError('Le départ est donné par l’organisateur.');
      if (h.selfPaced) {
        if (team.started) throw new ApiError('Votre équipe est déjà partie.');
        if (h.status !== 'published' && h.status !== 'running') throw new ApiError('Cette expédition est terminée.');
        const now = new Date().toISOString();
        if (h.status === 'published') {
          h.status = 'running';
          h.started = now;
        }
        team.started = now;
      } else {
        if (h.hostId !== me) throw new ApiError(`Le départ sera donné par ${this.nick(h.hostId!)}.`);
        if (h.status !== 'published') throw new ApiError('Cette expédition est déjà partie.');
        this.start(h);
      }
      return this.playState(huntId);
    });
  }

  setSelfPaced(huntId: number, selfPaced: boolean): Observable<Hunt> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.visibleHunt(huntId);
      if (!h.surprise) throw new ApiError('Chasse introuvable.');
      if (h.hostId !== me) throw new ApiError('Seul le créateur de l’expédition choisit le mode de départ.');
      if (h.status !== 'published') throw new ApiError('L’expédition est déjà partie.');
      h.selfPaced = selfPaced;
      return this.huntView(h);
    });
  }

  /* ---------- Génération ---------- */

  generateHunt(request: GenerationRequest): Observable<GenerationJob> {
    return this.reply(() => {
      const me = this.requireUser();
      const { lat, lng, query } = request.location;
      const center = lat !== undefined && lng !== undefined ? { lat, lng } : MONTPELLIER;
      const placeName = query?.trim() || 'votre quartier';
      const plan = demoPlan(center, plannedStepCount(request), placeName);
      const play = request.mode === 'play';
      if (play && !this.db.hunters.some((x) => x.id === SYSTEM_ID)) {
        this.db.hunters.push({ id: SYSTEM_ID, nickname: 'Treasure Hunters', email: 'generateur@treasurehunters.invalid', password: '', rateable: false });
      }
      const id = this.nextId(this.db.hunts);
      const begin = Date.now();
      const h: MockDb['hunts'][number] = {
        id,
        ownerId: play ? SYSTEM_ID : me,
        name: plan.name,
        description: plan.description,
        location: placeName,
        begin: new Date(begin).toISOString(),
        end: new Date(begin + (play ? 7 * 86_400_000 : request.durationMinutes * 60_000 * 2)).toISOString(),
        started: null,
        closed: null,
        autoStart: false,
        autoClose: true,
        award: plan.award,
        startMode: 'mass',
        interval: null,
        hintPenalties: [2, 5, 10],
        skipPenalty: 30,
        validation: 'geo',
        geoRadius: 40,
        generated: true,
        surprise: play,
        hostId: play ? me : null,
        catalogId: null,
        selfPaced: true,
        teamGame: true,
        teamMin: 1,
        teamMax: 6,
        isPublic: false,
        joinCode: randomToken(6).toUpperCase(),
        contribution: 0,
        startText: plan.startText,
        status: play ? 'published' : 'draft',
      };
      this.db.hunts.push(h);
      plan.steps.forEach((p, order) =>
        this.db.steps.push({
          ...this.blankStep(id, order, p.title),
          arrival: p.arrival,
          instructions: p.instructions,
          hints: p.hints,
          latitude: p.latitude,
          longitude: p.longitude,
          address: p.address,
        }),
      );
      if (play) this.addTeam(h, this.nick(me), me, false);
      const theme = request.theme?.trim();
      const note = theme ? `Thème « ${theme} » : la maquette ne cherche pas de vrais lieux, elle ne l’a pas suivi.` : null;
      const job = { id: randomToken(12), status: 'pending' as const, mode: request.mode, huntId: null, error: null, note: null };
      this.jobs.set(job.id, { ...job, huntId: id, note, readyAt: Date.now() + GENERATION_MS, ownerId: me });
      return job;
    });
  }

  getGeneration(id: string): Observable<GenerationJob> {
    return this.reply(() => {
      const job = this.jobs.get(id);
      if (!job || job.ownerId !== this.requireUser()) throw new ApiError('Génération introuvable.');
      const done = Date.now() >= job.readyAt;
      return { id: job.id, status: done ? 'done' : 'pending', mode: job.mode, huntId: done ? job.huntId : null, error: null, note: done ? job.note : null } satisfies GenerationJob;
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

  /* ---------- Catalogue (§ 13) ---------- */

  listCatalog(opts: CatalogQuery = {}): Observable<CatalogEntry[]> {
    return this.reply(() => {
      let list = this.catalog;
      if (opts.mine || opts.hunt) {
        const me = this.requireUser();
        list = list.filter((e) => e.authorId === me && (!opts.hunt || e.huntId === opts.hunt));
      } else {
        list = list.filter((e) => !e.withdrawn);
      }
      const q = opts.q?.trim().toLowerCase();
      if (q) list = list.filter((e) => [e.title, e.location, e.summary].some((t) => t.toLowerCase().includes(q)));
      const views = list.map((e) => this.entryView(e));
      const sort = opts.sort ?? 'rating';
      return views.sort((a, b) =>
        sort === 'recent'
          ? b.id - a.id
          : sort === 'plays'
            ? b.plays - a.plays || b.id - a.id
            : (b.rating.stars ?? -1) - (a.rating.stars ?? -1) || b.rating.count - a.rating.count || b.id - a.id,
      );
    });
  }

  getCatalogEntry(id: number): Observable<CatalogDetail> {
    return this.reply(() => this.entryDetail(id));
  }

  copyFromCatalog(id: number): Observable<Hunt> {
    return this.reply(() => {
      const me = this.requireUser();
      const e = this.catalog.find((x) => x.id === id && !x.withdrawn);
      if (!e) throw new ApiError('Cette chasse n’est pas au catalogue.');
      const begin = Date.now() + 7 * 86_400_000;
      const h: MockDb['hunts'][number] = {
        ...structuredClone(e.content.hunt),
        id: this.nextId(this.db.hunts),
        ownerId: me,
        begin: new Date(begin).toISOString(),
        end: new Date(begin + 3 * 3_600_000).toISOString(),
        started: null,
        closed: null,
        autoStart: false,
        autoClose: false,
        generated: false,
        surprise: false,
        hostId: null,
        selfPaced: true,
        catalogId: id,
        isPublic: false,
        joinCode: randomToken(6).toUpperCase(),
        status: 'draft',
      };
      this.db.hunts.push(h);
      for (const s of e.content.steps) this.db.steps.push({ ...this.blankStep(h.id, s.order, s.title), ...structuredClone(s) });
      return this.huntView(h);
    });
  }

  withdrawFromCatalog(id: number): Observable<CatalogDetail> {
    return this.reply(() => {
      const e = this.catalog.find((x) => x.id === id);
      if (!e) throw new ApiError('Cette chasse n’est pas au catalogue.');
      if (e.authorId !== this.requireUser()) throw new ApiError('Seul l’auteur retire sa chasse du catalogue.');
      e.withdrawn = true;
      return this.entryDetail(id);
    });
  }

  publishToCatalog(huntId: number, pub: CatalogPublication): Observable<CatalogDetail> {
    return this.reply(() => this.entryDetail(this.publish(this.ownedHunt(huntId), pub).id));
  }

  /* ---------- Notations (§ 14) ---------- */

  getRating(huntId: number): Observable<RatingState> {
    return this.reply(() => this.ratingState(huntId));
  }

  rateHunt(huntId: number, rating: Rating): Observable<RatingState> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.ratingState(huntId);
      if (!state.canRate) throw new ApiError('Seuls les joueurs de cette chasse la notent, une fois close.');
      const value = { ...rating, comment: rating.comment?.trim() || null, organizer: state.organizerRateable ? rating.organizer : null };
      const existing = this.ratings.find((r) => r.huntId === huntId && r.hunterId === me);
      if (existing) existing.rating = value;
      else this.ratings.push({ huntId, hunterId: me, rating: value, at: new Date().toISOString() });
      return this.ratingState(huntId);
    });
  }

  getOrganizer(id: number): Observable<OrganizerProfile> {
    return this.reply(() => {
      const h = this.db.hunters.find((x) => x.id === id && x.id !== SYSTEM_ID);
      if (!h) throw new ApiError('Organisateur introuvable.');
      const owned = new Set(this.db.hunts.filter((x) => x.ownerId === id).map((x) => x.id));
      const notes = this.ratings.filter((r) => owned.has(r.huntId) && r.rating.organizer !== null).map((r) => r.rating.organizer!);
      return {
        id,
        nickname: h.nickname,
        rateable: h.rateable,
        rating: h.rateable ? { count: notes.length, stars: average(notes) } : null,
        entries: this.catalog.filter((e) => e.authorId === id && !e.withdrawn).map((e) => this.entryView(e)),
      };
    });
  }

  private ratingState(huntId: number): RatingState {
    const me = this.viewer();
    const h = this.visibleHunt(huntId);
    const owner = this.db.hunters.find((x) => x.id === h.ownerId)!;
    return {
      canRate: me !== null && !!this.teamOf(huntId, me) && h.ownerId !== me && ['closed', 'archived'].includes(h.status),
      organizerRateable: owner.rateable,
      organizerNickname: owner.nickname,
      mine: this.ratings.find((r) => r.huntId === huntId && r.hunterId === me)?.rating ?? null,
    };
  }

  private publish(h: MockDb['hunts'][number], pub: CatalogPublication, authorId = h.ownerId): MockEntry {
    const steps = this.stepsOf(h.id);
    const final = finalOrder(steps);
    if (final < 2) throw new ApiError('Il faut au moins une étape entre le départ et l’arrivée pour publier.');
    const missing = steps.find((s) => s.order < final && !s.instructions?.trim());
    if (missing) throw new ApiError(`L’énigme ${missing.order === 0 ? 'de départ' : `de l’étape ${missing.order}`} n’est pas rédigée.`);
    const sample = steps.find((s) => s.order === pub.sampleOrder && s.order < final);
    if (!sample) throw new ApiError('Choisissez comme extrait une énigme du parcours.');
    const { name, description, location, award, startText, startMode, interval, hintPenalties, skipPenalty, teamGame, teamMin, teamMax, validation, geoRadius, contribution } = h;
    const content: MockEntry['content'] = {
      hunt: { name, description, location, award, startText, startMode, interval, hintPenalties, skipPenalty, teamGame, teamMin, teamMax, validation, geoRadius, contribution },
      steps: steps.map(({ order, title, arrival, instructions, hints, latitude, longitude, address }) => ({ order, title, arrival, instructions, hints, latitude, longitude, address })),
    };
    const fingerprint = JSON.stringify({ rules: [hintPenalties, skipPenalty, validation, geoRadius], steps: content.steps });
    const previous = this.catalog.filter((e) => e.huntId === h.id).at(-1);
    const parentId = previous?.id ?? h.catalogId;
    const parent = this.catalog.find((e) => e.id === parentId);
    if (parent && parent.fingerprint === fingerprint) {
      throw new ApiError(`Le parcours n’a pas changé depuis « ${parent.title} » : modifiez des étapes, des énigmes, des jokers ou des pénalités avant de publier une nouvelle version.`);
    }
    const entry: MockEntry = {
      id: this.catalog.length + 1,
      authorId,
      huntId: h.id,
      parentId: parent?.id ?? null,
      title: h.name,
      summary: pub.summary.trim() || h.description,
      location: h.location,
      difficulty: pub.difficulty,
      durationMinutes: pub.durationMinutes,
      stepCount: final,
      validation: h.validation,
      sampleOrder: sample.order,
      sample: sample.instructions!,
      changes: parent ? pub.changes?.trim() || null : null,
      content: structuredClone(content),
      fingerprint,
      published: new Date().toISOString(),
      withdrawn: false,
    };
    this.catalog.push(entry);
    return entry;
  }

  /** Parties qui comptent pour une version : la chasse qui l'a publiée et ses copies non republiées. */
  private entryHunts(e: MockEntry): number[] {
    const copies = this.db.hunts.filter((h) => h.catalogId === e.id && !this.catalog.some((x) => x.huntId === h.id)).map((h) => h.id);
    return [...(e.huntId ? [e.huntId] : []), ...copies];
  }

  private entryView(e: MockEntry): CatalogEntry {
    const hunts = new Set(this.entryHunts(e));
    const played = this.db.hunts.filter((h) => hunts.has(h.id) && ['closed', 'archived'].includes(h.status));
    const times = this.db.teams
      .filter((t) => hunts.has(t.huntId) && t.started && t.finished)
      .map((t) => (Date.parse(t.finished!) - Date.parse(t.started!)) / 60_000);
    const notes = this.ratings.filter((r) => hunts.has(r.huntId)).map((r) => r.rating);
    const parent = this.catalog.find((x) => x.id === e.parentId);
    return {
      id: e.id,
      authorId: e.authorId,
      authorNickname: this.nick(e.authorId),
      title: e.title,
      summary: e.summary,
      location: e.location,
      difficulty: e.difficulty,
      durationMinutes: e.durationMinutes,
      measuredMinutes: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
      stepCount: e.stepCount,
      validation: e.validation,
      plays: played.length,
      rating: {
        count: notes.length,
        stars: average(notes.map((n) => n.stars)),
        riddles: average(notes.map((n) => n.riddles)),
        route: average(notes.map((n) => n.route)),
        mood: average(notes.map((n) => n.mood)),
      },
      parent: parent ? { id: parent.id, title: parent.title, authorNickname: this.nick(parent.authorId) } : null,
      versionCount: this.catalog.filter((x) => x.parentId === e.id && !x.withdrawn).length,
      changes: e.changes,
      published: e.published,
      withdrawn: e.withdrawn,
    };
  }

  private entryDetail(id: number): CatalogDetail {
    const me = this.viewer();
    const e = this.catalog.find((x) => x.id === id);
    if (!e || (e.withdrawn && e.authorId !== me)) throw new ApiError('Cette chasse n’est pas au catalogue.');
    const hunts = new Set(this.entryHunts(e));
    return {
      ...this.entryView(e),
      sample: { order: e.sampleOrder, text: e.sample },
      reviews: this.ratings
        .filter((r) => hunts.has(r.huntId) && r.rating.comment)
        .reverse()
        .map((r) => ({ nickname: this.nick(r.hunterId), stars: r.rating.stars, comment: r.rating.comment!, at: r.at })),
      versions: this.catalog
        .filter((x) => x.parentId === id && (!x.withdrawn || x.authorId === me))
        .map((x) => ({ id: x.id, title: x.title, authorNickname: this.nick(x.authorId), published: x.published, withdrawn: x.withdrawn })),
      huntId: e.authorId === me ? e.huntId : null,
    };
  }

  /** Démonstration : la chasse close de Camille est au catalogue, avec quelques avis de ses joueurs. */
  private seedCatalog(): void {
    const closed = this.db.hunts.find((h) => h.status === 'closed');
    if (!closed) return;
    try {
      this.publish(closed, { summary: '', difficulty: 'medium', durationMinutes: 90, sampleOrder: 1, changes: null });
    } catch {
      return; // jeu de démonstration incomplet : catalogue vide
    }
    const players = this.db.teams.filter((t) => t.huntId === closed.id).flatMap((t) => t.members.map((m) => m.hunterId));
    const comments = ['Énigmes malignes, parcours superbe au bord de l’eau.', null, 'Un joker un peu trop facile, mais quelle ambiance !'];
    players.slice(0, 3).forEach((hunterId, i) =>
      this.ratings.push({
        huntId: closed.id,
        hunterId,
        rating: { stars: 5 - (i % 2), riddles: 4 + (i % 2), route: 5, mood: 4, comment: comments[i] ?? null, organizer: 5 },
        at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
      }),
    );
  }

  /* ---------- Preuve par photo (§ 12) ---------- */

  getFeatures(): Observable<Features> {
    return this.reply(() => ({ photos: true, generation: true }));
  }

  /** Arbitre simulé : la première photo d'une étape n'est pas reconnue, les suivantes le sont. */
  submitPhoto(huntId: number, image: string): Observable<PhotoResult> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.playState(huntId);
      if (state.hunt.validation !== 'qr') throw new ApiError('Cette chasse se valide par géolocalisation : appuyez sur « Je suis arrivé ».');
      if (!state.clue) throw new ApiError('Aucune étape à trouver pour le moment.');
      const step = this.stepsOf(huntId).find((s) => s.order === state.clue!.targetOrder)!;
      const tried = this.photos.some((p) => p.teamId === state.team.id && p.stepId === step.id);
      const photo: MockPhoto = {
        id: this.photos.length + 1,
        teamId: state.team.id,
        stepId: step.id,
        hunterId: me,
        image,
        at: new Date().toISOString(),
        verdict: tried ? 'match' : 'nomatch',
        reason: tried ? 'Le lieu est bien reconnu.' : 'La photo ne semble pas montrer le lieu de l’énigme.',
        insisted: false,
        counted: false,
        review: null,
      };
      this.photos.push(photo);
      if (tried) this.validateByPhoto(photo, me);
      return { photo: this.photoView(photo), state: this.playState(huntId) };
    });
  }

  insistPhoto(photoId: number): Observable<PhotoResult> {
    return this.reply(() => {
      const me = this.requireUser();
      const photo = this.photos.find((p) => p.id === photoId);
      const team = photo && this.db.teams.find((t) => t.id === photo.teamId);
      if (!photo || !team || !team.members.some((m) => m.hunterId === me)) throw new ApiError('Photo introuvable.');
      if (photo.counted) throw new ApiError('Cette photo a déjà validé l’étape.');
      const state = this.playState(team.huntId);
      const step = this.stepsOf(team.huntId).find((s) => s.id === photo.stepId)!;
      if (state.clue?.targetOrder !== step.order) throw new ApiError('Cette photo ne concerne plus l’énigme en cours.');
      photo.insisted = true;
      this.validateByPhoto(photo, me);
      return { photo: this.photoView(photo), state: this.playState(team.huntId) };
    });
  }

  huntPhotos(huntId: number): Observable<PhotoAttempt[]> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      return this.photosOf(huntId);
    });
  }

  reviewPhoto(photoId: number, approve: boolean): Observable<PhotoAttempt[]> {
    return this.reply(() => {
      const photo = this.photos.find((p) => p.id === photoId);
      const team = photo && this.db.teams.find((t) => t.id === photo.teamId);
      if (!photo || !team) throw new ApiError('Photo introuvable.');
      this.ownedHunt(team.huntId);
      if (!photo.counted) throw new ApiError('Cette photo n’a pas validé d’étape : rien à contrôler.');
      if (photo.review) throw new ApiError('Cette photo a déjà été contrôlée.');
      photo.review = approve ? 'approved' : 'rejected';
      if (!approve) {
        const steps = this.stepsOf(team.huntId);
        const val = this.db.validations.find((v) => v.teamId === team.id && v.stepId === photo.stepId)!;
        if (steps.find((s) => s.id === photo.stepId)!.order === finalOrder(steps)) {
          this.db.validations = this.db.validations.filter((v) => v !== val);
          team.finished = null;
        } else {
          val.source = 'SKIP';
        }
      }
      return this.photosOf(team.huntId);
    });
  }

  photoImage(photoId: number): Observable<Blob> {
    return this.blob(() => this.photos.find((p) => p.id === photoId)?.image ?? null);
  }

  referenceImage(stepId: number): Observable<Blob> {
    return this.blob(() => this.refPhotos.get(stepId) ?? null);
  }

  setReferencePhoto(stepId: number, image: string | null): Observable<Step> {
    return this.reply(() => {
      const step = this.db.steps.find((s) => s.id === stepId);
      if (!step) throw new ApiError('Étape introuvable.');
      this.ownedHunt(step.huntId);
      if (image === null) this.refPhotos.delete(stepId);
      else this.refPhotos.set(stepId, image);
      step.referencePhoto = image !== null;
      return step;
    });
  }

  private validateByPhoto(photo: MockPhoto, me: number): void {
    const team = this.db.teams.find((t) => t.id === photo.teamId)!;
    const steps = this.stepsOf(team.huntId);
    const now = new Date().toISOString();
    photo.counted = true;
    this.db.validations.push({ teamId: team.id, stepId: photo.stepId, hunterId: me, source: 'PHOTO', at: now });
    if (steps.find((s) => s.id === photo.stepId)!.order === finalOrder(steps)) team.finished = now;
  }

  private photosOf(huntId: number): PhotoAttempt[] {
    const teams = new Set(this.db.teams.filter((t) => t.huntId === huntId).map((t) => t.id));
    return this.photos.filter((p) => teams.has(p.teamId)).map((p) => this.photoView(p));
  }

  private photoView(p: MockPhoto): PhotoAttempt {
    const step = this.db.steps.find((s) => s.id === p.stepId)!;
    return {
      id: p.id,
      teamId: p.teamId,
      teamName: this.db.teams.find((t) => t.id === p.teamId)?.name ?? '',
      stepId: p.stepId,
      stepOrder: step.order,
      stepTitle: step.title,
      nickname: this.nick(p.hunterId),
      at: p.at,
      verdict: p.verdict,
      reason: p.reason,
      insisted: p.insisted,
      review: p.counted ? (p.review ?? 'pending') : null,
      hasReference: this.refPhotos.has(p.stepId),
      purged: false,
    };
  }

  private blob(fn: () => string | null): Observable<Blob> {
    return defer(() => {
      const url = fn();
      return url ? fetch(url).then((r) => r.blob()) : Promise.reject(new ApiError('Photo introuvable.'));
    }).pipe(delay(LATENCY_MS));
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

  /** Déclenchement : horodatage réel et heure de départ de chaque équipe (§ 5.1). */
  private start(h: MockDb['hunts'][number]): void {
    const now = new Date().toISOString();
    h.status = 'running';
    h.started = now;
    const teams = this.db.teams.filter((t) => t.huntId === h.id);
    const starts = teamStartTimes(h, teams, now);
    teams.forEach((t) => (t.started = starts.get(t.id) ?? null));
  }

  /** Chasse surprise : quand toutes les équipes sont arrivées, elle se clôt et le podium s'affiche. */
  private closeSurpriseIfAllArrived(h: MockDb['hunts'][number]): void {
    if (!h.surprise || this.db.teams.some((t) => t.huntId === h.id && !t.finished)) return;
    h.status = 'closed';
    h.closed = new Date().toISOString();
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
    if (h.status !== 'published' && !openToLateTeams(h)) throw new ApiError('Les inscriptions sont fermées.');
    if (h.ownerId === me) throw new ApiError('Vous organisez cette chasse.');
    if (this.teamOf(huntId, me)) throw new ApiError('Vous êtes déjà inscrit à cette chasse.');
    return h;
  }

  private huntView(h: MockDb['hunts'][number]): Hunt {
    return {
      ...h,
      ownerNickname: this.nick(h.ownerId),
      hostNickname: h.hostId === null ? null : this.nick(h.hostId),
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
        const photo = this.photos.find((p) => p.teamId === team.id && p.stepId === s.id && p.counted);
        return { order: s.order, title: s.title, arrival: s.arrival, at: v.at, skipped: v.source === 'SKIP', photo: photo ? ((photo.review ?? 'pending') as PhotoReview) : null };
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
        canSkip: current.order + 1 < finalOrder(steps),
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
      skipsUsed: vals.filter((v) => v.source === 'SKIP').length,
      penalty: penaltyMinutes(hunt, hints, vals),
      position,
      selfStart: canSelfStart(hunt, team, me),
      photoProof: hunt.validation === 'qr',
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
          skips: vals.filter((v) => v.source === 'SKIP').length,
          status,
          photosToReview: this.photos.filter((p) => p.teamId === team.id && p.counted && !p.review).length,
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
      referencePhoto: false,
    };
  }

  private nick(id: number): string {
    return this.db.hunters.find((h) => h.id === id)?.nickname ?? '?';
  }

  private publicHunter(h: Hunter): Hunter {
    return { id: h.id, nickname: h.nickname, email: h.email, rateable: h.rateable };
  }

  private nextId(list: { id: number }[]): number {
    return list.reduce((max, x) => Math.max(max, x.id), 0) + 1;
  }
}

/** Chasse surprise « chacun son chrono » en cours : on peut encore s'y inscrire et partir. */
function openToLateTeams(h: Pick<Hunt, 'surprise' | 'selfPaced' | 'status'>): boolean {
  return h.surprise && h.selfPaced && h.status === 'running';
}

/** Le joueur peut-il donner un départ (celui de son équipe, ou celui de tous) ? */
function canSelfStart(h: Hunt, team: Team, me: number): boolean {
  if (!h.surprise) return false;
  if (h.selfPaced) return !team.started && (h.status === 'published' || h.status === 'running');
  return h.status === 'published' && h.hostId === me;
}

interface MockPhoto {
  id: number;
  teamId: number;
  stepId: number;
  hunterId: number;
  image: string;
  at: string;
  verdict: 'match' | 'nomatch';
  reason: string;
  insisted: boolean;
  /** A validé l'étape (avis favorable ou insistance). */
  counted: boolean;
  review: Exclude<PhotoReview, 'pending'> | null;
}

interface MockEntry {
  id: number;
  authorId: number;
  huntId: number | null;
  parentId: number | null;
  title: string;
  summary: string;
  location: string;
  difficulty: CatalogPublication['difficulty'];
  durationMinutes: number;
  stepCount: number;
  validation: Hunt['validation'];
  sampleOrder: number;
  sample: string;
  changes: string | null;
  content: {
    hunt: Pick<
      Hunt,
      | 'name'
      | 'description'
      | 'location'
      | 'award'
      | 'startText'
      | 'startMode'
      | 'interval'
      | 'hintPenalties'
      | 'skipPenalty'
      | 'teamGame'
      | 'teamMin'
      | 'teamMax'
      | 'validation'
      | 'geoRadius'
      | 'contribution'
    >;
    steps: Pick<Step, 'order' | 'title' | 'arrival' | 'instructions' | 'hints' | 'latitude' | 'longitude' | 'address'>[];
  };
  fingerprint: string;
  published: string;
  withdrawn: boolean;
}

const average = (values: number[]): number | null =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

