/**
 * Logique métier de l'API (docs/conception.md § 3 à § 5). Les règles du jeu viennent de shared/rules.ts,
 * les mêmes que celles utilisées par les maquettes.
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import {
  AuthResult,
  CheckinResult,
  GenerationJob,
  GenerationRequest,
  Hunt,
  HuntStatus,
  LiveRow,
  PlayClue,
  PlayState,
  RankingRow,
  ScanOutcome,
  ScanResult,
  Step,
  Team,
  CatalogDetail,
  CatalogEntry,
  CatalogPublication,
  OrganizerProfile,
  Rating,
  RatingState,
  Features,
  PhotoAttempt,
  PhotoResult,
  PhotoReview,
} from '../../shared/models.js';
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
} from '../../shared/rules.js';
import { createSession, deleteSession, hashPassword, verifyPassword } from './auth.js';
import { config } from './config.js';
import { Db, one, Row, rows, tx } from './db.js';
import { badRequest, conflict, describeError, forbidden, HttpError, notFound, unauthorized } from './errors.js';
import {
  hintUsesOfHunt,
  huntAssignments,
  huntById,
  hunterById,
  huntsWhere,
  STATUS_IDS,
  stepById,
  toStep,
  stepByToken,
  stepsOf,
  teamById,
  teamOf,
  teamsWhere,
  toHunter,
  validationsOfHunt,
} from './repo.js';
import { HuntGenerator } from './generation/generator.js';
import { PhotoJudge } from './photos/judge.js';
import { imageType, PhotoStore, StoredPhoto } from './photos/store.js';
import { HuntPlan } from '../../shared/generation.js';

export type Viewer = number | null;
export type HuntScope = 'public' | 'playing' | 'organized';
export type HuntAction = 'publish' | 'unpublish' | 'start' | 'close' | 'cancel';
export type HuntInput = Partial<
  Omit<Hunt, 'id' | 'ownerId' | 'ownerNickname' | 'status' | 'started' | 'closed' | 'joinCode' | 'stepCount' | 'teamCount' | 'generated' | 'surprise'>
>;
export type StepInput = Partial<Pick<Step, 'title' | 'arrival' | 'instructions' | 'hints' | 'address' | 'latitude' | 'longitude'>>;

/** Champs modifiables pendant la course (les autres changeraient les règles en cours de jeu). */
const RUNNING_EDITABLE = new Set<keyof HuntInput>(['name', 'description', 'location', 'award', 'startText', 'end', 'autoClose', 'isPublic']);

function requireUser(viewer: Viewer): number {
  if (viewer === null) throw unauthorized();
  return viewer;
}

/** Code d'invitation lisible : 6 caractères sans ambiguïté (ni 0/O ni 1/I). */
function joinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomToken(6), (c) => alphabet[c.charCodeAt(0) % alphabet.length]).join('');
}

/** Le domaine réservé au compte système ne peut pas être pris par un joueur. */
function checkEmail(email: string): void {
  if (email.trim().toLowerCase().endsWith('.invalid')) throw badRequest('Adresse e-mail invalide.');
}

function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err.code === '23505' && (!constraint || err.constraint === constraint);
}

/** Compte « Treasure Hunters », organisateur des chasses surprises (créé à la demande, sans mot de passe). */
const SYSTEM_EMAIL = 'generateur@treasurehunters.invalid';
/** Une génération plus ancienne toujours en attente a été interrompue (redémarrage du serveur). */
const GENERATION_STALE_MINUTES = 10;

export class Service {
  /** Générations en cours dans ce processus (attendues par les tests). */
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly generator: HuntGenerator | null = null,
    private readonly log: (err: unknown, msg: string) => void = () => {},
    /** Preuve par photo (§ 12) : stockage et arbitre IA ; null si le stockage n'est pas configuré. */
    private readonly photos: { store: PhotoStore; judge: PhotoJudge | null } | null = null,
  ) {}

  /** Fonctions activées sur ce serveur, pour que le front n'affiche que ce qui marche. */
  features(): Features {
    return { photos: !!this.photos, generation: !!this.generator };
  }

  /* ================================================================ Comptes */

  async register(nickname: string, email: string, password: string, userAgent?: string): Promise<AuthResult> {
    checkEmail(email);
    const passwordHash = await hashPassword(password);
    return tx(this.pool, async (db) => {
      const clash = await one(
        db,
        'SELECT lower(htr_email) = lower($1) AS email FROM th_hunters WHERE lower(htr_email) = lower($1) OR lower(htr_nickname) = lower($2)',
        [email, nickname],
      );
      if (clash) throw conflict(clash['email'] ? 'Cet e-mail est déjà utilisé.' : 'Ce pseudo est déjà pris.');
      const r = await one(db, 'INSERT INTO th_hunters (htr_nickname, htr_email) VALUES ($1, $2) RETURNING *', [nickname.trim(), email.trim()]);
      await db.query('INSERT INTO th_secrets (sec_hunter_htr, sec_password) VALUES ($1, $2)', [r!['htr_id'], passwordHash]);
      const token = await createSession(db, r!['htr_id'], config.sessionDays, userAgent);
      return { user: toHunter(r!), token };
    });
  }

  async login(email: string, password: string, userAgent?: string): Promise<AuthResult> {
    const r = await one(
      this.pool,
      'SELECT h.*, s.sec_password FROM th_hunters h JOIN th_secrets s ON s.sec_hunter_htr = h.htr_id WHERE lower(h.htr_email) = lower($1)',
      [email.trim()],
    );
    if (!r || !(await verifyPassword(r['sec_password'], password))) throw unauthorized('E-mail ou mot de passe incorrect.');
    const token = await createSession(this.pool, r['htr_id'], config.sessionDays, userAgent);
    return { user: toHunter(r), token };
  }

  logout(token: string): Promise<void> {
    return deleteSession(this.pool, token);
  }

  async me(viewer: Viewer) {
    const me = await hunterById(this.pool, requireUser(viewer));
    if (!me) throw unauthorized();
    return me;
  }

  async updateMe(viewer: Viewer, data: { nickname?: string; email?: string; rateable?: boolean }) {
    const me = requireUser(viewer);
    if (data.email) checkEmail(data.email);
    try {
      const r = await one(
        this.pool,
        `UPDATE th_hunters SET htr_nickname = coalesce($2, htr_nickname), htr_email = coalesce($3, htr_email),
                htr_rateable = coalesce($4, htr_rateable), htr_lastupdate = now()
         WHERE htr_id = $1 RETURNING *`,
        [me, data.nickname?.trim() ?? null, data.email?.trim() ?? null, data.rateable ?? null],
      );
      return toHunter(r!);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('Ce pseudo ou cet e-mail est déjà utilisé.');
      throw e;
    }
  }

  /* ================================================================ Chasses */

  listHunts(viewer: Viewer, scope: HuntScope): Promise<Hunt[]> {
    switch (scope) {
      case 'public':
        return huntsWhere(this.pool, `h.hun_public AND s.hst_code IN ('published', 'running', 'closed')`, []);
      case 'playing':
        if (viewer === null) return Promise.resolve([]);
        return huntsWhere(this.pool, 'EXISTS (SELECT 1 FROM th_teamhunters m WHERE m.thr_hunt_hun = h.hun_id AND m.thr_hunter_htr = $1)', [viewer]);
      case 'organized':
        return huntsWhere(this.pool, 'h.hun_owner_htr = $1', [requireUser(viewer)]);
    }
  }

  getHunt(viewer: Viewer, id: number): Promise<Hunt> {
    return this.visibleHunt(this.pool, viewer, id);
  }

  async findByCode(viewer: Viewer, code: string): Promise<Hunt> {
    const c = code.trim().toUpperCase();
    const [hunt] = await huntsWhere(this.pool, `upper(h.hun_joincode) = $1 AND s.hst_code <> 'draft'`, [c]);
    if (hunt) return hunt;
    const team = await one(this.pool, 'SELECT tea_hunt_hun FROM th_teams WHERE upper(tea_joincode) = $1', [c]);
    if (team) return this.visibleHunt(this.pool, viewer, team['tea_hunt_hun']);
    throw notFound('Aucune chasse ni équipe ne correspond à ce code.');
  }

  async createHunt(viewer: Viewer, data: HuntInput): Promise<Hunt> {
    const me = requireUser(viewer);
    this.checkHuntData(data);
    return tx(this.pool, async (db) => {
      const assignments = huntAssignments(data as Partial<Hunt>);
      const cols = ['hun_owner_htr', 'hun_joincode', ...assignments.map(([c]) => c)];
      const values = [me, joinCode(), ...assignments.map(([, v]) => v)];
      const r = await one(
        db,
        `INSERT INTO th_hunts (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING hun_id`,
        values,
      );
      const id = r!['hun_id'] as number;
      // Toute chasse commence avec un départ et une arrivée.
      await db.query(
        `INSERT INTO th_codes (cod_hunt_hun, cod_order, cod_longid, cod_title) VALUES ($1, 0, NULL, 'Départ'), ($1, 1, $2, 'Arrivée')`,
        [id, randomToken()],
      );
      return (await huntById(db, id))!;
    });
  }

  async updateHunt(viewer: Viewer, id: number, data: HuntInput): Promise<Hunt> {
    return tx(this.pool, async (db) => {
      const hunt = await this.ownedHunt(db, viewer, id, true);
      if (['closed', 'cancelled', 'archived'].includes(hunt.status)) throw conflict('Cette expédition ne peut plus être modifiée.');
      if (hunt.status === 'running') {
        const locked = (Object.keys(data) as (keyof HuntInput)[]).filter((k) => !RUNNING_EDITABLE.has(k));
        const changed = locked.filter((k) => JSON.stringify(data[k]) !== JSON.stringify(hunt[k]));
        if (changed.length) throw conflict('Les règles ne peuvent plus changer une fois la course lancée.');
      }
      this.checkHuntData({ ...hunt, ...data });
      const assignments = huntAssignments(data as Partial<Hunt>);
      if (assignments.length) {
        const set = assignments.map(([c], i) => `${c} = $${i + 2}`).join(', ');
        await db.query(`UPDATE th_hunts SET ${set}, hun_lastupdate = now() WHERE hun_id = $1`, [id, ...assignments.map(([, v]) => v)]);
      }
      return (await huntById(db, id))!;
    });
  }

  async huntAction(viewer: Viewer, id: number, action: HuntAction): Promise<Hunt> {
    return tx(this.pool, async (db) => {
      const hunt = await this.ownedHunt(db, viewer, id, true);
      const expect = (...statuses: HuntStatus[]) => {
        if (!statuses.includes(hunt.status)) throw conflict('Action impossible dans l’état actuel de la chasse.');
      };
      switch (action) {
        case 'publish':
          expect('draft');
          if (hunt.stepCount < 1) throw conflict('Ajoutez au moins une étape avant de publier.');
          if (hunt.validation === 'geo') {
            const missing = (await stepsOf(db, id)).filter((s) => s.order > 0 && (s.latitude === null || s.longitude === null));
            if (missing.length) throw conflict(`Validation par géolocalisation : placez sur la carte « ${missing[0].title} ».`);
          }
          await this.setStatus(db, id, 'published');
          break;
        case 'unpublish': {
          expect('published');
          const teams = await one(db, 'SELECT count(*)::int AS n FROM th_teams WHERE tea_hunt_hun = $1', [id]);
          if (teams!['n'] > 0) throw conflict('Des équipes sont déjà inscrites.');
          await this.setStatus(db, id, 'draft');
          break;
        }
        case 'start':
          expect('published');
          await this.start(db, hunt);
          break;
        case 'close':
          expect('running');
          await db.query(`UPDATE th_hunts SET hun_closed = now(), hun_status_hst = $2, hun_lastupdate = now() WHERE hun_id = $1`, [
            id,
            STATUS_IDS.closed,
          ]);
          break;
        case 'cancel':
          expect('draft', 'published', 'running');
          await this.setStatus(db, id, 'cancelled');
          break;
      }
      return (await huntById(db, id))!;
    });
  }

  /** Déclenchement : horodatage réel et heure de départ de chaque équipe (§ 5.1). */
  private async start(db: Db, hunt: Hunt): Promise<void> {
    const now = (await one(db, 'SELECT now() AS now'))!['now'] as Date;
    await db.query(`UPDATE th_hunts SET hun_started = $2, hun_status_hst = $3, hun_lastupdate = now() WHERE hun_id = $1`, [
      hunt.id,
      now,
      STATUS_IDS.running,
    ]);
    const teams = await teamsWhere(db, 't.tea_hunt_hun = $1', [hunt.id]);
    const starts = teamStartTimes(hunt, teams, now.toISOString());
    for (const [teamId, started] of starts) {
      await db.query('UPDATE th_teams SET tea_started = $2, tea_lastupdate = now() WHERE tea_id = $1', [teamId, started]);
    }
  }

  /** Départs et clôtures automatiques à l'heure prévue. Renvoie le nombre de chasses modifiées. */
  async runSchedule(): Promise<number> {
    let changed = 0;
    const toStart = await rows(
      this.pool,
      `SELECT hun_id FROM th_hunts WHERE hun_status_hst = $1 AND hun_autostart AND hun_begin <= now()`,
      [STATUS_IDS.published],
    );
    for (const r of toStart) {
      await tx(this.pool, async (db) => {
        const hunt = await huntById(db, r['hun_id'], true);
        if (hunt?.status === 'published') {
          await this.start(db, hunt);
          changed++;
        }
      });
    }
    const closed = await this.pool.query(
      `UPDATE th_hunts SET hun_closed = now(), hun_status_hst = $1, hun_lastupdate = now()
       WHERE hun_status_hst = $2 AND hun_autoclose AND hun_end <= now()`,
      [STATUS_IDS.closed, STATUS_IDS.running],
    );
    return changed + (closed.rowCount ?? 0) + (await this.purgePhotos());
  }

  /* ================================================================ Étapes */

  async getSteps(viewer: Viewer, huntId: number): Promise<Step[]> {
    await this.ownedHunt(this.pool, viewer, huntId);
    return stepsOf(this.pool, huntId);
  }

  async createStep(viewer: Viewer, huntId: number, data: StepInput): Promise<Step> {
    return tx(this.pool, async (db) => {
      const hunt = await this.ownedHunt(db, viewer, huntId, true);
      this.checkStructureEditable(hunt);
      // Une nouvelle étape s'insère juste avant l'arrivée, qui recule d'un rang.
      const final = hunt.stepCount;
      await db.query('UPDATE th_codes SET cod_order = cod_order + 1 WHERE cod_hunt_hun = $1 AND cod_order = $2', [huntId, final]);
      const r = await one(
        db,
        `INSERT INTO th_codes (cod_hunt_hun, cod_order, cod_longid, cod_title) VALUES ($1, $2, $3, $4) RETURNING cod_id`,
        [huntId, final, randomToken(), data.title ?? `Étape ${final}`],
      );
      return this.writeStep(db, r!['cod_id'], data);
    });
  }

  async updateStep(viewer: Viewer, stepId: number, data: StepInput): Promise<Step> {
    return tx(this.pool, async (db) => {
      const step = await stepById(db, stepId);
      if (!step) throw notFound('Étape introuvable.');
      const hunt = await this.ownedHunt(db, viewer, step.huntId);
      if (['closed', 'cancelled', 'archived'].includes(hunt.status)) throw conflict('Cette expédition ne peut plus être modifiée.');
      return this.writeStep(db, stepId, data);
    });
  }

  private async writeStep(db: Db, id: number, data: StepInput): Promise<Step> {
    const cols: [string, unknown][] = [];
    if (data.title !== undefined) cols.push(['cod_title', data.title]);
    if (data.arrival !== undefined) cols.push(['cod_arrival', data.arrival]);
    if (data.instructions !== undefined) cols.push(['cod_instructions', data.instructions]);
    if (data.address !== undefined) cols.push(['cod_address', data.address]);
    if (data.latitude !== undefined) cols.push(['cod_latitude', data.latitude]);
    if (data.longitude !== undefined) cols.push(['cod_longitude', data.longitude]);
    if (data.hints !== undefined) {
      const hints = data.hints.filter((h) => h.trim());
      [1, 2, 3].forEach((n) => cols.push([`cod_hint${n}`, hints[n - 1] ?? null]));
    }
    if (cols.length) {
      const set = cols.map(([c], i) => `${c} = $${i + 2}`).join(', ');
      await db.query(`UPDATE th_codes SET ${set}, cod_lastupdate = now() WHERE cod_id = $1`, [id, ...cols.map(([, v]) => v)]);
    }
    return (await stepById(db, id))!;
  }

  async deleteStep(viewer: Viewer, stepId: number): Promise<void> {
    await tx(this.pool, async (db) => {
      const step = await stepById(db, stepId);
      if (!step) throw notFound('Étape introuvable.');
      const hunt = await this.ownedHunt(db, viewer, step.huntId, true);
      this.checkStructureEditable(hunt);
      if (step.order === 0 || step.order === hunt.stepCount) throw conflict('Le départ et l’arrivée ne peuvent pas être supprimés.');
      await db.query('DELETE FROM th_codes WHERE cod_id = $1', [stepId]);
      await db.query('UPDATE th_codes SET cod_order = cod_order - 1 WHERE cod_hunt_hun = $1 AND cod_order > $2', [step.huntId, step.order]);
    });
  }

  async reorderSteps(viewer: Viewer, huntId: number, stepIds: number[]): Promise<Step[]> {
    return tx(this.pool, async (db) => {
      const hunt = await this.ownedHunt(db, viewer, huntId, true);
      this.checkStructureEditable(hunt);
      const steps = await stepsOf(db, huntId);
      const middle = steps.slice(1, -1).map((s) => s.id);
      if (stepIds.length !== middle.length || new Set(stepIds).size !== stepIds.length || !middle.every((id) => stepIds.includes(id))) {
        throw badRequest('Liste d’étapes invalide.');
      }
      await db.query('SET CONSTRAINTS un_cod_2 DEFERRED');
      for (const [i, id] of stepIds.entries()) {
        await db.query('UPDATE th_codes SET cod_order = $2, cod_lastupdate = now() WHERE cod_id = $1', [id, i + 1]);
      }
      return stepsOf(db, huntId);
    });
  }

  async regenerateToken(viewer: Viewer, stepId: number): Promise<Step> {
    const step = await stepById(this.pool, stepId);
    if (!step || step.order === 0) throw notFound('Étape introuvable.');
    await this.ownedHunt(this.pool, viewer, step.huntId);
    await this.pool.query('UPDATE th_codes SET cod_longid = $2, cod_lastupdate = now() WHERE cod_id = $1', [stepId, randomToken()]);
    return (await stepById(this.pool, stepId))!;
  }

  /* ================================================================ Équipes */

  async getTeams(viewer: Viewer, huntId: number): Promise<Team[]> {
    await this.visibleHunt(this.pool, viewer, huntId);
    return teamsWhere(this.pool, 't.tea_hunt_hun = $1', [huntId]);
  }

  async myTeam(viewer: Viewer, huntId: number): Promise<Team | null> {
    return teamOf(this.pool, huntId, viewer);
  }

  async createTeam(viewer: Viewer, huntId: number, name: string): Promise<Team> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const hunt = await this.joinableHunt(db, huntId, me);
      if (!hunt.teamGame) throw conflict('Cette chasse se joue en solo.');
      try {
        return await this.addTeam(db, hunt, name.trim(), me, false);
      } catch (e) {
        if (isUniqueViolation(e, 'un_tea_1')) throw conflict('Une équipe porte déjà ce nom.');
        throw e;
      }
    });
  }

  async joinTeam(viewer: Viewer, code: string): Promise<Team> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const r = await one(db, 'SELECT tea_id FROM th_teams WHERE upper(tea_joincode) = $1', [code.trim().toUpperCase()]);
      if (!r) throw notFound('Code d’équipe inconnu.');
      const team = (await teamById(db, r['tea_id'], true))!;
      const hunt = await this.joinableHunt(db, team.huntId, me);
      if (team.solo) throw conflict('Cette chasse se joue en solo.');
      if (team.members.length >= hunt.teamMax) throw conflict('Cette équipe est complète.');
      if (team.finished) throw conflict('Cette équipe a déjà terminé l’expédition.');
      await db.query('INSERT INTO th_teamhunters (thr_team_tea, thr_hunt_hun, thr_hunter_htr) VALUES ($1, $2, $3)', [team.id, hunt.id, me]);
      return (await teamById(db, team.id))!;
    });
  }

  async joinSolo(viewer: Viewer, huntId: number): Promise<Team> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const hunt = await this.joinableHunt(db, huntId, me);
      if (hunt.teamGame) throw conflict('Cette chasse se joue en équipe.');
      const nickname = (await hunterById(db, me))!.nickname;
      return this.addTeam(db, hunt, nickname, me, true);
    });
  }

  async leaveHunt(viewer: Viewer, huntId: number): Promise<void> {
    const me = requireUser(viewer);
    await tx(this.pool, async (db) => {
      const team = await teamOf(db, huntId, me);
      if (!team) return;
      const hunt = (await huntById(db, huntId, true))!;
      if (hunt.surprise && hunt.hostId === me) throw conflict('Vous avez créé cette expédition : vous ne pouvez pas la quitter.');
      // Chasse surprise « chacun son chrono » : on peut partir tant que son équipe n'a pas donné son départ.
      if (hunt.status !== 'published' && !(openToLateTeams(hunt) && !team.started)) throw conflict('La chasse a déjà commencé.');
      await db.query('DELETE FROM th_teamhunters WHERE thr_team_tea = $1 AND thr_hunter_htr = $2', [team.id, me]);
      const rest = team.members.filter((m) => m.hunterId !== me);
      if (rest.length === 0) await db.query('DELETE FROM th_teams WHERE tea_id = $1', [team.id]);
      else if (team.ownerId === me) await db.query('UPDATE th_teams SET tea_owner_htr = $2 WHERE tea_id = $1', [team.id, rest[0].hunterId]);
      if (hunt.status === 'running') await this.closeSurpriseIfAllArrived(db, hunt);
    });
  }

  async setStartOrder(viewer: Viewer, huntId: number, teamIds: number[]): Promise<Team[]> {
    return tx(this.pool, async (db) => {
      const hunt = await this.ownedHunt(db, viewer, huntId, true);
      if (hunt.status !== 'published') throw conflict('L’ordre de passage se fixe avant le déclenchement.');
      for (const [i, id] of teamIds.entries()) {
        await db.query('UPDATE th_teams SET tea_startorder = $3, tea_lastupdate = now() WHERE tea_id = $1 AND tea_hunt_hun = $2', [
          id,
          huntId,
          i + 1,
        ]);
      }
      return teamsWhere(db, 't.tea_hunt_hun = $1', [huntId]);
    });
  }

  async delayTeam(viewer: Viewer, teamId: number, minutes: number): Promise<Team> {
    return tx(this.pool, async (db) => {
      const team = await teamById(db, teamId, true);
      if (!team) throw notFound('Équipe introuvable.');
      const hunt = await this.ownedHunt(db, viewer, team.huntId);
      if (hunt.status !== 'running' || !team.started) throw conflict('La chasse n’est pas en cours.');
      if (team.finished) throw conflict('Cette équipe est déjà arrivée.');
      // Jamais avant le déclenchement de la chasse.
      await db.query(
        `UPDATE th_teams SET tea_started = greatest(tea_started + make_interval(mins => $2), $3::timestamptz), tea_lastupdate = now()
         WHERE tea_id = $1`,
        [teamId, minutes, hunt.started],
      );
      return (await teamById(db, teamId))!;
    });
  }

  /* ================================================================ Jeu */

  async getPlay(viewer: Viewer, huntId: number): Promise<PlayState> {
    return this.playState(this.pool, requireUser(viewer), huntId);
  }

  async revealHint(viewer: Viewer, huntId: number): Promise<PlayState> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const team = await teamOf(db, huntId, me);
      if (!team) throw forbidden('Vous n’êtes pas inscrit à cette chasse.');
      await teamById(db, team.id, true); // un seul joker à la fois par équipe
      const state = await this.playState(db, me, huntId);
      const clue = state.clue;
      if (!clue) throw conflict('Aucune énigme en cours.');
      if (clue.hintsRevealed.length >= clue.hintsTotal) throw conflict('Tous les jokers sont déjà dévoilés.');
      await db.query('INSERT INTO th_hintuses (hiu_team_tea, hiu_code_cod, hiu_level, hiu_hunter_htr) VALUES ($1, $2, $3, $4)', [
        team.id,
        clue.stepId,
        clue.hintsRevealed.length + 1,
        me,
      ]);
      return this.playState(db, me, huntId);
    });
  }

  /**
   * Abandon de l'épreuve en cours (« 4ᵉ joker », § 5.2) : l'étape cherchée est validée
   * sans QR (source SKIP), l'énigme suivante se dévoile, la pénalité d'abandon s'ajoute
   * au temps. L'arrivée ne s'abandonne pas : il faut trouver le trésor pour être classé.
   */
  async skipStep(viewer: Viewer, huntId: number): Promise<PlayState> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const team = await teamOf(db, huntId, me);
      if (!team) throw forbidden('Vous n’êtes pas inscrit à cette chasse.');
      await teamById(db, team.id, true); // sérialisé avec les scans de l'équipe
      const state = await this.playState(db, me, huntId);
      const clue = state.clue;
      if (!clue) throw conflict('Aucune épreuve en cours.');
      if (!clue.canSkip) throw conflict('L’arrivée ne peut pas être abandonnée : il faut trouver le trésor.');
      const target = (await stepsOf(db, huntId)).find((s) => s.order === clue.targetOrder)!;
      await db.query(
        `INSERT INTO th_validations (val_team_tea, val_code_cod, val_hunter_htr, val_source) VALUES ($1, $2, $3, 'SKIP')`,
        [team.id, target.id, me],
      );
      return this.playState(db, me, huntId);
    });
  }

  /**
   * « Je suis arrivé » (validation par géolocalisation, § 11.3) : l'étape cherchée est
   * validée si le joueur est dans le rayon du lieu, précision du GPS comprise (plafonnée).
   * Journalisé dans th_scanlog comme un scan, avec le jeton « geo:<étape> ».
   */
  async checkin(viewer: Viewer, huntId: number, pos: { lat: number; lng: number; accuracy: number }, ip?: string): Promise<CheckinResult> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const team = await teamOf(db, huntId, me);
      if (!team) throw forbidden('Vous n’êtes pas inscrit à cette chasse.');
      await teamById(db, team.id, true); // sérialisé avec les scans et abandons de l'équipe
      const hunt = (await huntById(db, huntId))!;
      if (hunt.validation !== 'geo') throw conflict('Cette chasse se joue avec les QR codes posés sur place.');
      const state = await this.playState(db, me, huntId);
      const clue = state.clue;
      if (!clue) throw conflict('Aucune étape à trouver pour le moment.');
      const steps = await stepsOf(db, huntId);
      const target = steps.find((s) => s.order === clue.targetOrder)!;
      if (target.latitude === null || target.longitude === null) throw conflict('Ce lieu n’est pas placé sur la carte : prévenez l’organisateur.');

      const distance = Math.round(distanceMeters({ lat: pos.lat, lng: pos.lng }, { lat: target.latitude, lng: target.longitude }));
      const allowed = Math.round(checkinAllowance(hunt, pos.accuracy));
      const outcome = distance <= allowed ? 'validated' : 'too_far';
      await db.query(
        'INSERT INTO th_scanlog (scl_code_cod, scl_token, scl_hunter_htr, scl_team_tea, scl_result, scl_ip) VALUES ($1, $2, $3, $4, $5, $6)',
        [target.id, `geo:${target.id}`, me, team.id, outcome, ip ?? null],
      );
      if (outcome === 'too_far') return { outcome, distance, allowed, step: null, state };

      const final = finalOrder(steps);
      await db.query(`INSERT INTO th_validations (val_team_tea, val_code_cod, val_hunter_htr, val_source) VALUES ($1, $2, $3, 'GEO')`, [
        team.id,
        target.id,
        me,
      ]);
      if (target.order === final) {
        await db.query('UPDATE th_teams SET tea_finished = now() WHERE tea_id = $1', [team.id]);
        await this.closeSurpriseIfAllArrived(db, hunt);
      }
      return {
        outcome,
        distance,
        allowed,
        step: { order: target.order, title: target.title, arrival: target.arrival, isFinal: target.order === final },
        state: await this.playState(db, me, huntId),
      };
    });
  }

  /**
   * Chasse surprise : les joueurs donnent eux-mêmes le départ, quand ils sont prêts (§ 11.4).
   * « Chacun son chrono » : chaque équipe part pour elle-même. Départ commun : l'hôte lance
   * toutes les équipes à la fois.
   */
  async selfStart(viewer: Viewer, huntId: number): Promise<PlayState> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const hunt = await huntById(db, huntId, true);
      const mine = hunt ? await teamOf(db, huntId, me) : null;
      if (!hunt || !mine) throw notFound('Chasse introuvable.');
      if (!hunt.surprise) throw forbidden('Le départ est donné par l’organisateur.');
      if (hunt.selfPaced) {
        const team = (await teamById(db, mine.id, true))!;
        if (team.started) throw conflict('Votre équipe est déjà partie.');
        if (hunt.status !== 'published' && hunt.status !== 'running') throw conflict('Cette expédition est terminée.');
        const now = (await one(db, 'SELECT now() AS now'))!['now'] as Date;
        if (hunt.status === 'published') {
          await db.query(`UPDATE th_hunts SET hun_started = $2, hun_status_hst = $3, hun_lastupdate = now() WHERE hun_id = $1`, [
            hunt.id,
            now,
            STATUS_IDS.running,
          ]);
        }
        await db.query('UPDATE th_teams SET tea_started = $2, tea_lastupdate = now() WHERE tea_id = $1', [team.id, now]);
      } else {
        if (hunt.hostId !== me) throw forbidden(`Le départ sera donné par ${hunt.hostNickname ?? 'le créateur de l’expédition'}.`);
        if (hunt.status !== 'published') throw conflict('Cette expédition est déjà partie.');
        await this.start(db, hunt);
      }
      return this.playState(db, me, huntId);
    });
  }

  /** Chasse surprise, avant le départ : l'hôte choisit « chacun son chrono » ou départ commun. */
  async setSelfPaced(viewer: Viewer, huntId: number, selfPaced: boolean): Promise<Hunt> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const hunt = await huntById(db, huntId, true);
      if (!hunt || !hunt.surprise) throw notFound('Chasse introuvable.');
      if (hunt.hostId !== me) throw forbidden('Seul le créateur de l’expédition choisit le mode de départ.');
      if (hunt.status !== 'published') throw conflict('L’expédition est déjà partie.');
      await db.query('UPDATE th_hunts SET hun_selfpaced = $2, hun_lastupdate = now() WHERE hun_id = $1', [huntId, selfPaced]);
      return (await huntById(db, huntId))!;
    });
  }

  /** Scan d'un QR code : algorithme du § 4.2, journalisé dans th_scanlog. */
  async scan(viewer: Viewer, token: string, ip?: string): Promise<ScanResult> {
    return tx(this.pool, async (db) => {
      const step = await stepByToken(db, token);
      const hunt = step ? await huntById(db, step.huntId) : null;
      let team = hunt ? await teamOf(db, hunt.id, viewer) : null;
      if (team) team = await teamById(db, team.id, true); // sérialise les scans d'une même équipe
      const steps = hunt ? await stepsOf(db, hunt.id) : [];
      const validations = team ? (await validationsOfHunt(db, hunt!.id)).filter((v) => v.teamId === team!.id) : [];
      const now = (await one(db, 'SELECT now() AS now'))!['now'] as Date;
      const outcome = evaluateScan({ hunt, steps, step, viewerId: viewer, team, validations, now: now.getTime() });

      await this.logScan(db, token, step?.id ?? null, viewer, team?.id ?? null, outcome, ip);
      const result: ScanResult = { outcome, hunt: null, step: null, next: null, team, podium: null };
      if (outcome === 'unknown') return result;
      result.hunt = hunt;

      const final = finalOrder(steps);
      const stepInfo = { order: step!.order, title: step!.title, arrival: step!.arrival, isFinal: step!.order === final };

      if (outcome === 'validated') {
        await db.query('INSERT INTO th_validations (val_team_tea, val_code_cod, val_hunter_htr, val_creation) VALUES ($1, $2, $3, $4)', [
          team!.id,
          step!.id,
          viewer,
          now,
        ]);
        if (step!.order === final) await db.query('UPDATE th_teams SET tea_finished = $2 WHERE tea_id = $1', [team!.id, now]);
        result.team = await teamById(db, team!.id);
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
        result.next = (await this.playState(db, viewer!, hunt!.id)).clue;
      }
      if (outcome === 'closed') result.podium = (await this.ranking(db, hunt!)).slice(0, 3);
      return result;
    });
  }

  private async logScan(db: Db, token: string, stepId: number | null, viewer: Viewer, teamId: number | null, outcome: ScanOutcome, ip?: string) {
    await db.query(
      'INSERT INTO th_scanlog (scl_code_cod, scl_token, scl_hunter_htr, scl_team_tea, scl_result, scl_ip) VALUES ($1, $2, $3, $4, $5, $6)',
      [stepId, token.slice(0, 64), viewer, teamId, outcome, ip ?? null],
    );
  }

  private async playState(db: Db, me: number, huntId: number): Promise<PlayState> {
    const hunt = await this.visibleHunt(db, me, huntId);
    const team = await teamOf(db, huntId, me);
    if (!team) throw forbidden('Vous n’êtes pas inscrit à cette chasse.');
    const steps = await stepsOf(db, huntId);
    const allValidations = await validationsOfHunt(db, huntId);
    const allHints = await hintUsesOfHunt(db, huntId);
    const vals = allValidations.filter((v) => v.teamId === team.id);
    const hints = allHints.filter((u) => u.teamId === team.id);
    const photoReviews = new Map(
      (
        await rows(db, 'SELECT val_code_cod, pho_review FROM th_validations JOIN th_photos ON pho_id = val_photo_pho WHERE val_team_tea = $1', [
          team.id,
        ])
      ).map((r) => [r['val_code_cod'] as number, (r['pho_review'] ?? 'pending') as PhotoReview]),
    );
    const validated = vals
      .map((v) => {
        const s = steps.find((x) => x.id === v.stepId)!;
        return { order: s.order, title: s.title, arrival: s.arrival, at: v.at, skipped: v.source === 'SKIP', photo: photoReviews.get(s.id) ?? null };
      })
      .sort((a, b) => a.order - b.order);

    let clue: PlayClue | null = null;
    const now = Date.now();
    const started = team.started !== null && Date.parse(team.started) <= now;
    if (hunt.status === 'running' && started && !team.finished) {
      const current = steps.find((s) => s.order === lastValidatedOrder(steps, vals))!;
      const revealed = hints.filter((u) => u.stepId === current.id).sort((a, b) => a.level - b.level);
      clue = {
        stepId: current.id,
        targetOrder: current.order + 1,
        instructions: current.instructions ?? '',
        hintsRevealed: revealed.map((u) => current.hints[u.level - 1]).filter((h) => h !== undefined),
        hintsTotal: current.hints.length,
        canSkip: current.order + 1 < finalOrder(steps),
      };
    }

    // Position provisoire : les joueurs ne voient que celle de leur équipe (§ 5.3).
    let position: PlayState['position'] = null;
    if (hunt.status === 'running' && team.started) {
      const teams = await teamsWhere(db, 't.tea_hunt_hun = $1', [huntId]);
      position = teamPosition(computeRanking(hunt, teams, allValidations, allHints), team.id);
    }

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
      photoProof: !!this.photos && hunt.validation === 'qr',
    };
  }

  /* ================================================================ Résultats et pilotage */

  async getResults(viewer: Viewer, huntId: number): Promise<RankingRow[]> {
    const hunt = await this.visibleHunt(this.pool, viewer, huntId);
    const ended = hunt.status === 'closed' || hunt.status === 'archived';
    if (!ended && hunt.ownerId !== viewer) throw forbidden('Les résultats seront publiés à la clôture de la chasse.');
    return this.ranking(this.pool, hunt);
  }

  async getLive(viewer: Viewer, huntId: number): Promise<LiveRow[]> {
    await this.ownedHunt(this.pool, viewer, huntId);
    return this.liveRows(this.pool, huntId);
  }

  async validateManually(viewer: Viewer, teamId: number, stepId: number): Promise<LiveRow[]> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const team = await teamById(db, teamId, true);
      if (!team) throw notFound('Équipe introuvable.');
      const hunt = await this.ownedHunt(db, me, team.huntId);
      if (hunt.status !== 'running') throw conflict('La chasse n’est pas en cours.');
      const steps = await stepsOf(db, hunt.id);
      const step = steps.find((s) => s.id === stepId);
      if (!step) throw notFound('Étape introuvable.');
      const vals = (await validationsOfHunt(db, hunt.id)).filter((v) => v.teamId === teamId);
      if (step.order !== lastValidatedOrder(steps, vals) + 1) throw conflict('Seule l’étape suivante de l’équipe peut être validée.');
      await db.query(
        `INSERT INTO th_validations (val_team_tea, val_code_cod, val_hunter_htr, val_source, val_by_htr) VALUES ($1, $2, $3, 'MANUAL', $4)`,
        [teamId, stepId, team.ownerId, me],
      );
      if (step.order === finalOrder(steps)) await db.query('UPDATE th_teams SET tea_finished = now() WHERE tea_id = $1', [teamId]);
      return this.liveRows(db, hunt.id);
    });
  }

  private async ranking(db: Db, hunt: Hunt): Promise<RankingRow[]> {
    const teams = await teamsWhere(db, 't.tea_hunt_hun = $1', [hunt.id]);
    return computeRanking(hunt, teams, await validationsOfHunt(db, hunt.id), await hintUsesOfHunt(db, hunt.id));
  }

  private async liveRows(db: Db, huntId: number): Promise<LiveRow[]> {
    const steps = await stepsOf(db, huntId);
    const teams = await teamsWhere(db, 't.tea_hunt_hun = $1', [huntId]);
    const validations = await validationsOfHunt(db, huntId);
    const hints = await hintUsesOfHunt(db, huntId);
    const toReview = await rows(
      db,
      `SELECT val_team_tea, count(*)::int AS n FROM th_validations JOIN th_photos ON pho_id = val_photo_pho
       JOIN th_teams ON tea_id = val_team_tea WHERE tea_hunt_hun = $1 AND pho_review IS NULL GROUP BY val_team_tea`,
      [huntId],
    );
    const now = Date.now();
    return teams.map((team) => {
      const vals = validations.filter((v) => v.teamId === team.id);
      const status: LiveRow['status'] = team.finished ? 'finished' : team.started && Date.parse(team.started) <= now ? 'running' : 'waiting';
      return {
        team,
        lastOrder: lastValidatedOrder(steps, vals),
        lastAt: vals.map((v) => v.at).sort().at(-1) ?? null,
        hints: hints.filter((u) => u.teamId === team.id).length,
        skips: vals.filter((v) => v.source === 'SKIP').length,
        status,
        photosToReview: toReview.find((r) => r['val_team_tea'] === team.id)?.['n'] ?? 0,
      };
    });
  }

  /* ================================================================ Preuve par photo (§ 12) */

  /**
   * QR introuvable : l'équipe envoie une photo du lieu qu'elle pense être la solution.
   * Si l'IA la juge évidente, l'étape est validée (sous réserve du contrôle de l'organisateur) ;
   * sinon l'équipe peut réessayer, ou insister à ses risques (insistPhoto).
   */
  async submitPhoto(viewer: Viewer, huntId: number, image: string): Promise<PhotoResult> {
    const me = requireUser(viewer);
    const photos = this.requirePhotos();
    const photo = decodeImage(image);
    // Contrôles avant l'envoi au stockage et à l'IA (qui prennent du temps, hors transaction).
    const before = await this.playState(this.pool, me, huntId);
    const target = await this.photoTarget(this.pool, before);
    const key = `photos/hunt-${huntId}/team-${before.team.id}/${randomToken(16)}.${photo.contentType.split('/')[1]}`;
    await photos.store.put(key, photo);

    let verdict: 'match' | 'nomatch' | 'unavailable' = 'unavailable';
    let reason = 'L’arbitre photo n’est pas disponible : vous pouvez reprendre une photo, ou insister et l’organisateur la contrôlera.';
    if (photos.judge) {
      try {
        const reference = target.refKey ? await photos.store.get(target.refKey) : null;
        const v = await photos.judge.judge({
          place: { title: target.step.title, arrival: target.step.arrival, address: target.step.address },
          riddle: target.riddle,
          reference,
          photo,
        });
        verdict = v.match ? 'match' : 'nomatch';
        reason = v.reason;
      } catch (e) {
        this.log(e, `Arbitre photo indisponible (chasse ${huntId}) — ${describeError(e)}`);
      }
    }

    return tx(this.pool, async (db) => {
      await teamById(db, before.team.id, true); // sérialisé avec les scans de l'équipe
      const state = await this.playState(db, me, huntId);
      // Entre-temps, un équipier a pu valider l'étape (QR retrouvé, autre photo) : la photo reste une tentative.
      const still = state.clue?.targetOrder === target.step.order;
      const counted = verdict === 'match' && still;
      const r = await one(
        db,
        `INSERT INTO th_photos (pho_team_tea, pho_code_cod, pho_hunter_htr, pho_key, pho_verdict, pho_reason)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING pho_id`,
        [state.team.id, target.step.id, me, key, verdict, reason],
      );
      const photoId = r!['pho_id'] as number;
      if (counted) await this.validateByPhoto(db, state.team.id, target.step, me, photoId);
      return { photo: (await this.photoAttempts(db, 'pho_id = $1', [photoId]))[0], state: await this.playState(db, me, huntId) };
    });
  }

  /** L'équipe confirme une photo que l'IA n'a pas reconnue : si l'organisateur la refuse, l'épreuve compte comme abandonnée. */
  async insistPhoto(viewer: Viewer, photoId: number): Promise<PhotoResult> {
    const me = requireUser(viewer);
    this.requirePhotos();
    return tx(this.pool, async (db) => {
      const p = await one(db, 'SELECT p.*, t.tea_hunt_hun FROM th_photos p JOIN th_teams t ON t.tea_id = p.pho_team_tea WHERE pho_id = $1', [photoId]);
      const mine = p ? await teamOf(db, p['tea_hunt_hun'], me) : null;
      if (!p || !mine || mine.id !== p['pho_team_tea']) throw notFound('Photo introuvable.');
      await teamById(db, mine.id, true);
      if (p['pho_verdict'] === 'match' || p['pho_insisted']) throw conflict('Cette photo a déjà validé l’étape.');
      const state = await this.playState(db, me, p['tea_hunt_hun']);
      const target = await this.photoTarget(db, state);
      if (target.step.id !== p['pho_code_cod']) throw conflict('Cette photo ne concerne plus l’énigme en cours.');
      await db.query('UPDATE th_photos SET pho_insisted = true, pho_lastupdate = now() WHERE pho_id = $1', [photoId]);
      await this.validateByPhoto(db, mine.id, target.step, me, photoId);
      return { photo: (await this.photoAttempts(db, 'pho_id = $1', [photoId]))[0], state: await this.playState(db, me, p['tea_hunt_hun']) };
    });
  }

  /** Toutes les photos d'une chasse, pour le contrôle de l'organisateur. */
  async huntPhotos(viewer: Viewer, huntId: number): Promise<PhotoAttempt[]> {
    const hunt = await this.ownedHunt(this.pool, viewer, huntId);
    return this.photoAttempts(this.pool, 't.tea_hunt_hun = $1', [hunt.id]);
  }

  /**
   * Contrôle de l'organisateur, pendant la course ou après la clôture. Une photo refusée compte
   * comme un abandon de l'épreuve (pénalité d'abandon) ; pour l'arrivée, qui ne s'abandonne pas,
   * l'équipe n'est plus arrivée.
   */
  async reviewPhoto(viewer: Viewer, photoId: number, approve: boolean): Promise<PhotoAttempt[]> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const p = await one(db, 'SELECT p.*, t.tea_hunt_hun FROM th_photos p JOIN th_teams t ON t.tea_id = p.pho_team_tea WHERE pho_id = $1', [photoId]);
      if (!p) throw notFound('Photo introuvable.');
      const hunt = await this.ownedHunt(db, me, p['tea_hunt_hun']);
      await teamById(db, p['pho_team_tea'], true);
      const val = await one(db, 'SELECT * FROM th_validations WHERE val_photo_pho = $1', [photoId]);
      if (!val) throw conflict('Cette photo n’a pas validé d’étape : rien à contrôler.');
      if (p['pho_review']) throw conflict('Cette photo a déjà été contrôlée.');
      if (!['running', 'closed'].includes(hunt.status)) throw conflict('La chasse n’est ni en cours ni close.');
      await db.query('UPDATE th_photos SET pho_review = $2, pho_reviewed_by_htr = $3, pho_lastupdate = now() WHERE pho_id = $1', [
        photoId,
        approve ? 'approved' : 'rejected',
        me,
      ]);
      if (!approve) {
        const steps = await stepsOf(db, hunt.id);
        const step = steps.find((s) => s.id === val['val_code_cod'])!;
        if (step.order === finalOrder(steps)) {
          await db.query('DELETE FROM th_validations WHERE val_id = $1', [val['val_id']]);
          await db.query('UPDATE th_teams SET tea_finished = NULL, tea_lastupdate = now() WHERE tea_id = $1', [p['pho_team_tea']]);
        } else {
          await db.query(`UPDATE th_validations SET val_source = 'SKIP' WHERE val_id = $1`, [val['val_id']]);
        }
      }
      return this.photoAttempts(db, 't.tea_hunt_hun = $1', [hunt.id]);
    });
  }

  /** Image d'une photo d'équipe : pour l'équipe elle-même et l'organisateur. */
  async photoImage(viewer: Viewer, photoId: number): Promise<StoredPhoto> {
    const me = requireUser(viewer);
    const photos = this.requirePhotos();
    const p = await one(
      this.pool,
      `SELECT p.pho_key, p.pho_team_tea, h.hun_id, h.hun_owner_htr FROM th_photos p
       JOIN th_teams t ON t.tea_id = p.pho_team_tea JOIN th_hunts h ON h.hun_id = t.tea_hunt_hun WHERE pho_id = $1`,
      [photoId],
    );
    const allowed = p && (p['hun_owner_htr'] === me || (await teamOf(this.pool, p['hun_id'], me))?.id === p['pho_team_tea']);
    if (!allowed) throw notFound('Photo introuvable.');
    const image = p['pho_key'] ? await photos.store.get(p['pho_key']) : null;
    if (!image) throw notFound('Cette photo a été effacée.');
    return image;
  }

  /** Photo de référence d'une étape : l'organisateur seul (elle dévoilerait la solution). */
  async referenceImage(viewer: Viewer, stepId: number): Promise<StoredPhoto> {
    const photos = this.requirePhotos();
    const { key } = await this.ownedStepPhoto(viewer, stepId);
    const image = key ? await photos.store.get(key) : null;
    if (!image) throw notFound('Pas de photo de référence pour cette étape.');
    return image;
  }

  async setReferencePhoto(viewer: Viewer, stepId: number, image: string | null): Promise<Step> {
    const photos = this.requirePhotos();
    const { step, key: old } = await this.ownedStepPhoto(viewer, stepId);
    if (step.order === 0) throw badRequest('Le départ n’a pas de lieu à photographier.');
    let key: string | null = null;
    if (image !== null) {
      const photo = decodeImage(image);
      key = `refs/hunt-${step.huntId}/step-${step.id}-${randomToken(16)}.${photo.contentType.split('/')[1]}`;
      await photos.store.put(key, photo);
    }
    await this.pool.query('UPDATE th_codes SET cod_refphoto = $2, cod_lastupdate = now() WHERE cod_id = $1', [stepId, key]);
    if (old) await photos.store.delete(old).catch((e) => this.log(e, `Photo de référence ${old} non effacée`));
    return (await stepById(this.pool, stepId))!;
  }

  /** Photos des équipes effacées quelques jours après la clôture de leur chasse. */
  private async purgePhotos(): Promise<number> {
    if (!this.photos) return 0;
    const old = await rows(
      this.pool,
      `SELECT p.pho_id, p.pho_key FROM th_photos p JOIN th_teams t ON t.tea_id = p.pho_team_tea JOIN th_hunts h ON h.hun_id = t.tea_hunt_hun
       WHERE p.pho_key IS NOT NULL AND h.hun_closed < now() - make_interval(days => $1) LIMIT 200`,
      [config.photoRetentionDays],
    );
    let purged = 0;
    for (const r of old) {
      try {
        await this.photos.store.delete(r['pho_key']);
        await this.pool.query('UPDATE th_photos SET pho_key = NULL, pho_lastupdate = now() WHERE pho_id = $1', [r['pho_id']]);
        purged++;
      } catch (e) {
        this.log(e, `Photo ${r['pho_key']} non effacée`);
      }
    }
    return purged;
  }

  private requirePhotos() {
    if (!this.photos) throw new HttpError(503, 'La preuve par photo n’est pas activée sur ce serveur.');
    return this.photos;
  }

  /** Étape cherchée par l'équipe, à laquelle une photo peut se substituer au QR. */
  private async photoTarget(db: Db, state: PlayState) {
    if (state.hunt.validation !== 'qr') throw conflict('Cette chasse se valide par géolocalisation : appuyez sur « Je suis arrivé ».');
    if (!state.clue) throw conflict('Aucune étape à trouver pour le moment.');
    const r = await one(db, 'SELECT * FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order = $2', [state.hunt.id, state.clue.targetOrder]);
    return { step: toStep(r!), refKey: r!['cod_refphoto'] as string | null, riddle: state.clue.instructions || null };
  }

  private async validateByPhoto(db: Db, teamId: number, step: Step, me: number, photoId: number): Promise<void> {
    await db.query(`INSERT INTO th_validations (val_team_tea, val_code_cod, val_hunter_htr, val_source, val_photo_pho) VALUES ($1, $2, $3, 'PHOTO', $4)`, [
      teamId,
      step.id,
      me,
      photoId,
    ]);
    const steps = await stepsOf(db, step.huntId);
    if (step.order === finalOrder(steps)) await db.query('UPDATE th_teams SET tea_finished = now() WHERE tea_id = $1', [teamId]);
  }

  private async ownedStepPhoto(viewer: Viewer, stepId: number) {
    const r = await one(this.pool, 'SELECT * FROM th_codes WHERE cod_id = $1', [stepId]);
    if (!r) throw notFound('Étape introuvable.');
    await this.ownedHunt(this.pool, viewer, r['cod_hunt_hun']);
    return { step: toStep(r), key: r['cod_refphoto'] as string | null };
  }

  private async photoAttempts(db: Db, where: string, params: unknown[]): Promise<PhotoAttempt[]> {
    const list = await rows(
      db,
      `SELECT p.*, t.tea_name, c.cod_order, c.cod_title, c.cod_refphoto, u.htr_nickname, v.val_id
       FROM th_photos p
       JOIN th_teams t ON t.tea_id = p.pho_team_tea
       JOIN th_codes c ON c.cod_id = p.pho_code_cod
       LEFT JOIN th_hunters u ON u.htr_id = p.pho_hunter_htr
       LEFT JOIN th_validations v ON v.val_photo_pho = p.pho_id
       WHERE ${where} ORDER BY p.pho_id`,
      params,
    );
    return list.map((r) => ({
      id: r['pho_id'],
      teamId: r['pho_team_tea'],
      teamName: r['tea_name'],
      stepId: r['pho_code_cod'],
      stepOrder: r['cod_order'],
      stepTitle: r['cod_title'],
      nickname: r['htr_nickname'],
      at: (r['pho_creation'] as Date).toISOString(),
      verdict: r['pho_verdict'],
      reason: r['pho_reason'],
      insisted: r['pho_insisted'],
      // Une photo refusée pour l'arrivée n'a plus de validation, mais reste « refusée ».
      review: r['pho_review'] ?? (r['val_id'] ? 'pending' : null),
      hasReference: !!r['cod_refphoto'],
      purged: !r['pho_key'],
    }));
  }

  /* ================================================================ Catalogue (§ 13) */

  /**
   * Publie une version de la chasse au catalogue : instantané des réglages et des étapes.
   * Une copie (ou une republication) doit avoir changé le parcours par rapport à la version
   * dont elle vient.
   */
  async publishToCatalog(viewer: Viewer, huntId: number, pub: CatalogPublication): Promise<CatalogDetail> {
    const me = requireUser(viewer);
    const id = await tx(this.pool, async (db) => {
      const hunt = await this.ownedHunt(db, me, huntId, true);
      if (hunt.status === 'cancelled') throw conflict('Une chasse annulée ne se publie pas.');
      const steps = await stepsOf(db, huntId);
      const final = finalOrder(steps);
      if (final < 2) throw badRequest('Il faut au moins une étape entre le départ et l’arrivée pour publier.');
      const missing = steps.find((s) => s.order < final && !s.instructions?.trim());
      if (missing) throw badRequest(`L’énigme ${missing.order === 0 ? 'de départ' : `de l’étape ${missing.order}`} n’est pas rédigée.`);
      const sample = steps.find((s) => s.order === pub.sampleOrder && s.order < final);
      if (!sample) throw badRequest('Choisissez comme extrait une énigme du parcours.');

      const content = catalogContent(hunt, steps);
      const fingerprint = contentFingerprint(content);
      // Version précédente : la dernière publication de cette chasse, sinon la version copiée.
      const previous = await one(db, 'SELECT cat_id FROM th_catalog WHERE cat_hunt_hun = $1 ORDER BY cat_id DESC LIMIT 1', [huntId]);
      const parentId: number | null = previous?.['cat_id'] ?? hunt.catalogId;
      if (parentId) {
        const parent = (await one(db, 'SELECT cat_title, cat_fingerprint FROM th_catalog WHERE cat_id = $1', [parentId]))!;
        if (parent['cat_fingerprint'] === fingerprint) {
          throw conflict(
            `Le parcours n’a pas changé depuis « ${parent['cat_title']} » : modifiez des étapes, des énigmes, des jokers ou des pénalités avant de publier une nouvelle version.`,
          );
        }
      }
      const r = await one(
        db,
        `INSERT INTO th_catalog (cat_author_htr, cat_hunt_hun, cat_parent_cat, cat_title, cat_summary, cat_location, cat_difficulty,
                                 cat_duration, cat_stepcount, cat_validation, cat_sample_order, cat_sample, cat_changes, cat_content, cat_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING cat_id`,
        [
          me,
          huntId,
          parentId,
          hunt.name,
          pub.summary.trim() || hunt.description,
          hunt.location,
          pub.difficulty,
          pub.durationMinutes,
          final,
          hunt.validation,
          sample.order,
          sample.instructions,
          parentId ? pub.changes?.trim() || null : null,
          JSON.stringify(content),
          fingerprint,
        ],
      );
      return r!['cat_id'] as number;
    });
    return this.catalogEntry(me, id);
  }

  /** Catalogue public : versions non retirées, les mieux notées d'abord (ou les plus récentes, les plus jouées). */
  listCatalog(viewer: Viewer, opts: { q?: string; sort?: 'rating' | 'recent' | 'plays'; mine?: boolean; hunt?: number }): Promise<CatalogEntry[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (opts.mine || opts.hunt) {
      params.push(requireUser(viewer));
      where.push(`c.cat_author_htr = $${params.length}`);
      if (opts.hunt) {
        params.push(opts.hunt);
        where.push(`c.cat_hunt_hun = $${params.length}`);
      }
    } else {
      where.push('c.cat_withdrawn IS NULL');
    }
    if (opts.q?.trim()) {
      params.push(`%${opts.q.trim().replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`(c.cat_title ILIKE $${params.length} OR c.cat_location ILIKE $${params.length} OR c.cat_summary ILIKE $${params.length})`);
    }
    const order = {
      rating: 'ra.stars DESC NULLS LAST, coalesce(ra.n, 0) DESC, c.cat_id DESC',
      recent: 'c.cat_id DESC',
      plays: 'coalesce(pl.plays, 0) DESC, c.cat_id DESC',
    }[opts.sort ?? 'rating'];
    return catalogEntries(this.pool, where.join(' AND '), params, order);
  }

  async catalogEntry(viewer: Viewer, id: number): Promise<CatalogDetail> {
    const [entry] = await catalogEntries(this.pool, 'c.cat_id = $1', [id]);
    const r = await one(this.pool, 'SELECT cat_sample_order, cat_sample, cat_hunt_hun FROM th_catalog WHERE cat_id = $1', [id]);
    if (!entry || !r || (entry.withdrawn && entry.authorId !== viewer)) throw notFound('Cette chasse n’est pas au catalogue.');
    const reviews = await rows(
      this.pool,
      `${ENTRY_HUNTS} SELECT u.htr_nickname, r.rat_stars, r.rat_comment, r.rat_creation
       FROM eh JOIN th_ratings r ON r.rat_hunt_hun = eh.hun_id JOIN th_hunters u ON u.htr_id = r.rat_hunter_htr
       WHERE eh.cat_id = $1 AND r.rat_comment IS NOT NULL ORDER BY r.rat_id DESC LIMIT 20`,
      [id],
    );
    const versions = await rows(
      this.pool,
      `SELECT c.cat_id, c.cat_title, u.htr_nickname, c.cat_creation, c.cat_withdrawn FROM th_catalog c JOIN th_hunters u ON u.htr_id = c.cat_author_htr
       WHERE c.cat_parent_cat = $1 AND (c.cat_withdrawn IS NULL OR c.cat_author_htr = $2) ORDER BY c.cat_id`,
      [id, viewer],
    );
    return {
      ...entry,
      sample: { order: r['cat_sample_order'], text: r['cat_sample'] },
      reviews: reviews.map((x) => ({ nickname: x['htr_nickname'], stars: x['rat_stars'], comment: x['rat_comment'], at: (x['rat_creation'] as Date).toISOString() })),
      versions: versions.map((x) => ({
        id: x['cat_id'],
        title: x['cat_title'],
        authorNickname: x['htr_nickname'],
        published: (x['cat_creation'] as Date).toISOString(),
        withdrawn: !!x['cat_withdrawn'],
      })),
      huntId: entry.authorId === viewer ? r['cat_hunt_hun'] : null,
    };
  }

  /** Crée un brouillon à partir d'une version du catalogue : l'organisateur l'adapte ensuite librement. */
  async copyFromCatalog(viewer: Viewer, id: number): Promise<Hunt> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const r = await one(db, 'SELECT cat_content, cat_withdrawn FROM th_catalog WHERE cat_id = $1', [id]);
      if (!r || r['cat_withdrawn']) throw notFound('Cette chasse n’est pas au catalogue.');
      const content = r['cat_content'] as CatalogContent;
      const begin = new Date(Date.now() + 7 * 86_400_000);
      const data: Partial<Hunt> = {
        ...content.hunt,
        begin: begin.toISOString(),
        end: new Date(begin.getTime() + 3 * 3_600_000).toISOString(),
        isPublic: false,
      };
      const assignments = huntAssignments(data);
      const cols = ['hun_owner_htr', 'hun_joincode', 'hun_catalog_cat', ...assignments.map(([c]) => c)];
      const values = [me, joinCode(), id, ...assignments.map(([, v]) => v)];
      const h = await one(db, `INSERT INTO th_hunts (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING hun_id`, values);
      const huntId = h!['hun_id'] as number;
      for (const s of content.steps) {
        await db.query(
          `INSERT INTO th_codes (cod_hunt_hun, cod_order, cod_longid, cod_title, cod_arrival, cod_instructions, cod_hint1, cod_hint2, cod_hint3,
                                 cod_latitude, cod_longitude, cod_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            huntId,
            s.order,
            s.order === 0 ? null : randomToken(), // de nouveaux QR : ceux de l'auteur restent les siens
            s.title,
            s.arrival,
            s.instructions,
            s.hints[0] ?? null,
            s.hints[1] ?? null,
            s.hints[2] ?? null,
            s.latitude,
            s.longitude,
            s.address,
          ],
        );
      }
      return (await huntById(db, huntId))!;
    });
  }

  /** L'auteur retire une version : elle disparaît du catalogue, les copies déjà faites restent. */
  async withdrawFromCatalog(viewer: Viewer, id: number): Promise<CatalogDetail> {
    const me = requireUser(viewer);
    const r = await one(this.pool, 'SELECT cat_author_htr FROM th_catalog WHERE cat_id = $1', [id]);
    if (!r) throw notFound('Cette chasse n’est pas au catalogue.');
    if (r['cat_author_htr'] !== me) throw forbidden('Seul l’auteur retire sa chasse du catalogue.');
    await this.pool.query('UPDATE th_catalog SET cat_withdrawn = coalesce(cat_withdrawn, now()), cat_lastupdate = now() WHERE cat_id = $1', [id]);
    return this.catalogEntry(me, id);
  }

  /* ================================================================ Notations (§ 14) */

  /** Un joueur inscrit note la chasse après sa clôture ; l'organisateur n'est noté que s'il l'accepte. */
  async ratingState(viewer: Viewer, huntId: number): Promise<RatingState> {
    const hunt = await this.visibleHunt(this.pool, viewer, huntId);
    const owner = (await one(this.pool, 'SELECT htr_nickname, htr_rateable FROM th_hunters WHERE htr_id = $1', [hunt.ownerId]))!;
    const member = viewer !== null && !!(await teamOf(this.pool, huntId, viewer));
    const mine = viewer === null ? null : await one(this.pool, 'SELECT * FROM th_ratings WHERE rat_hunt_hun = $1 AND rat_hunter_htr = $2', [huntId, viewer]);
    return {
      canRate: member && hunt.ownerId !== viewer && ['closed', 'archived'].includes(hunt.status),
      organizerRateable: owner['htr_rateable'],
      organizerNickname: owner['htr_nickname'],
      mine: mine ? toRating(mine) : null,
    };
  }

  async rateHunt(viewer: Viewer, huntId: number, rating: Rating): Promise<RatingState> {
    const me = requireUser(viewer);
    const state = await this.ratingState(me, huntId);
    if (!state.canRate) throw forbidden('Seuls les joueurs de cette chasse la notent, une fois close.');
    await this.pool.query(
      `INSERT INTO th_ratings (rat_hunt_hun, rat_hunter_htr, rat_stars, rat_riddles, rat_route, rat_mood, rat_comment, rat_organizer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (rat_hunt_hun, rat_hunter_htr) DO UPDATE SET rat_stars = $3, rat_riddles = $4, rat_route = $5, rat_mood = $6,
         rat_comment = $7, rat_organizer = $8, rat_lastupdate = now()`,
      [
        huntId,
        me,
        rating.stars,
        rating.riddles,
        rating.route,
        rating.mood,
        rating.comment?.trim() || null,
        state.organizerRateable ? rating.organizer : null,
      ],
    );
    return this.ratingState(me, huntId);
  }

  /** Fiche publique d'un organisateur : ses chasses au catalogue et, s'il l'accepte, sa note. */
  async organizerProfile(viewer: Viewer, id: number): Promise<OrganizerProfile> {
    const h = await hunterById(this.pool, id);
    if (!h || h.email === SYSTEM_EMAIL) throw notFound('Organisateur introuvable.');
    let rating: OrganizerProfile['rating'] = null;
    if (h.rateable) {
      const r = (await one(
        this.pool,
        `SELECT count(r.rat_organizer)::int AS n, avg(r.rat_organizer) AS stars FROM th_ratings r JOIN th_hunts x ON x.hun_id = r.rat_hunt_hun
         WHERE x.hun_owner_htr = $1`,
        [id],
      ))!;
      rating = { count: r['n'], stars: r['stars'] === null ? null : Math.round(Number(r['stars']) * 10) / 10 };
    }
    const entries = await catalogEntries(this.pool, 'c.cat_author_htr = $1 AND c.cat_withdrawn IS NULL', [id]);
    return { id: h.id, nickname: h.nickname, rateable: h.rateable, rating, entries };
  }

  /* ================================================================ Génération (§ 11) */

  /** Lance l'invention d'une chasse en tâche de fond ; le front suit la génération. */
  async generate(viewer: Viewer, req: GenerationRequest): Promise<GenerationJob> {
    const me = requireUser(viewer);
    if (!this.generator) throw new HttpError(503, 'La génération de chasses n’est pas activée sur ce serveur.');
    const job = await tx(this.pool, async (db) => {
      // Sérialise les demandes d'un même joueur pour que le quota tienne.
      await db.query('SELECT 1 FROM th_hunters WHERE htr_id = $1 FOR UPDATE', [me]);
      // Seules les générations réussies ou en cours comptent : un échec ne coûte rien au joueur.
      // Les essais, échecs compris, restent plafonnés pour ménager OpenStreetMap et l'API.
      const recent = await one(
        db,
        `SELECT count(*) FILTER (WHERE gen_status <> 'error')::int AS used, count(*)::int AS attempts
         FROM th_generations WHERE gen_hunter_htr = $1 AND gen_creation > now() - interval '1 day'`,
        [me],
      );
      if (recent!['used'] >= config.generationDailyQuota) {
        throw new HttpError(429, `Vous avez déjà inventé ${config.generationDailyQuota} chasses aujourd’hui : revenez demain !`);
      }
      if (recent!['attempts'] >= config.generationDailyQuota * 4) {
        throw new HttpError(429, 'Trop d’essais aujourd’hui : le générateur semble en difficulté, réessayez demain.');
      }
      return one(db, `INSERT INTO th_generations (gen_hunter_htr, gen_params) VALUES ($1, $2) RETURNING *`, [me, JSON.stringify(req)]);
    });
    const run = this.runGeneration(job!['gen_id'], me, req).finally(() => this.inflight.delete(run));
    this.inflight.add(run);
    return toJob(job!);
  }

  async getGeneration(viewer: Viewer, id: string): Promise<GenerationJob> {
    const me = requireUser(viewer);
    await this.pool.query(
      `UPDATE th_generations SET gen_status = 'error', gen_error = $2, gen_lastupdate = now()
       WHERE gen_id = $1 AND gen_status = 'pending' AND gen_creation < now() - make_interval(mins => $3)`,
      [id, 'La génération a été interrompue, relancez-la.', GENERATION_STALE_MINUTES],
    );
    const r = await one(this.pool, 'SELECT * FROM th_generations WHERE gen_id = $1 AND gen_hunter_htr = $2', [id, me]);
    if (!r) throw notFound('Génération introuvable.');
    return toJob(r);
  }

  /** Attend la fin des générations en cours (tests, arrêt propre). */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  private async runGeneration(jobId: string, me: number, req: GenerationRequest): Promise<void> {
    try {
      const { plan, location, note } = await this.generator!.generate(req);
      await tx(this.pool, async (db) => {
        const huntId = await this.createFromPlan(db, me, req, plan, location);
        await db.query(`UPDATE th_generations SET gen_status = 'done', gen_hunt_hun = $2, gen_note = $3, gen_lastupdate = now() WHERE gen_id = $1`, [
          jobId,
          huntId,
          note ?? null,
        ]);
      });
    } catch (e) {
      // Toujours journalisé, avec la cause technique : le joueur ne voit que le message.
      // La raison technique figure aussi dans le message : c'est souvent la seule ligne affichée.
      const cause = e instanceof HttpError && e.cause ? e.cause : e;
      this.log(cause, `Échec de la génération ${jobId}${e instanceof HttpError ? ` : ${e.message}` : ''} — ${describeError(cause)}`);
      const message = e instanceof HttpError ? e.message : 'La génération a échoué, réessayez dans un instant.';
      await this.pool
        .query(`UPDATE th_generations SET gen_status = 'error', gen_error = $2, gen_lastupdate = now() WHERE gen_id = $1`, [jobId, message])
        .catch((err) => this.log(err, 'Échec de l’enregistrement d’une erreur de génération'));
    }
  }

  /**
   * Chasse inventée, validée par géolocalisation. Mode « play » : chasse surprise organisée
   * par le compte système ; le joueur (l'hôte) y a son équipe, peut inviter coéquipiers et
   * adversaires, et les départs se donnent depuis l'application. Mode
   * « organize » : brouillon ordinaire dont le joueur devient l'organisateur.
   */
  private async createFromPlan(db: Db, me: number, req: GenerationRequest, plan: HuntPlan, location: string): Promise<number> {
    const play = req.mode === 'play';
    const owner = play ? await this.systemAccount(db) : me;
    const r = await one(
      db,
      `INSERT INTO th_hunts (hun_owner_htr, hun_joincode, hun_name, hun_description, hun_location, hun_begin, hun_end,
                             hun_autostart, hun_autoclose, hun_award, hun_starttext, hun_startmode, hun_penalty1, hun_penalty2,
                             hun_penalty3, hun_skippenalty, hun_teamgame, hun_teammin, hun_teammax, hun_public, hun_status_hst,
                             hun_validation, hun_georadius, hun_generated, hun_surprise, hun_host_htr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, true, $8, $9, 1, 2, 5, 10, 15, true, 1, $10, false, $11, 'geo', 40, true, $12, $13)
       RETURNING hun_id`,
      [
        owner,
        joinCode(),
        plan.name,
        plan.description,
        location.slice(0, 255),
        // Surprise : jouable dans la semaine ; à organiser : le lendemain, à ajuster.
        play ? new Date() : new Date(Date.now() + 86_400_000),
        new Date(Date.now() + (play ? 7 * 86_400_000 : 86_400_000 + Math.max(2, req.durationMinutes / 30) * 3_600_000)),
        plan.award,
        plan.startText,
        // Surprise : l'équipe du joueur, que des coéquipiers peuvent rejoindre ; des adversaires peuvent s'inscrire.
        SURPRISE_TEAM_MAX,
        STATUS_IDS[play ? 'published' : 'draft'],
        play,
        play ? me : null,
      ],
    );
    const huntId = r!['hun_id'] as number;
    for (const [order, s] of plan.steps.entries()) {
      await db.query(
        `INSERT INTO th_codes (cod_hunt_hun, cod_order, cod_longid, cod_title, cod_arrival, cod_instructions, cod_hint1, cod_hint2, cod_hint3,
                               cod_latitude, cod_longitude, cod_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          huntId,
          order,
          order === 0 ? null : randomToken(),
          s.title,
          s.arrival,
          s.instructions,
          s.hints[0] ?? null,
          s.hints[1] ?? null,
          s.hints[2] ?? null,
          s.latitude,
          s.longitude,
          s.address,
        ],
      );
    }
    if (play) {
      const nickname = (await hunterById(db, me))!.nickname;
      await this.addTeam(db, (await huntById(db, huntId))!, nickname, me, false);
    }
    return huntId;
  }

  private async systemAccount(db: Db): Promise<number> {
    await db.query(
      `INSERT INTO th_hunters (htr_nickname, htr_email) VALUES ('Treasure Hunters', $1)
       ON CONFLICT DO NOTHING`,
      [SYSTEM_EMAIL],
    );
    // Sans mot de passe : personne ne peut se connecter avec ce compte.
    const r = await one(
      db,
      `SELECT htr_id FROM th_hunters h WHERE lower(htr_email) = $1 AND NOT EXISTS (SELECT 1 FROM th_secrets WHERE sec_hunter_htr = h.htr_id)`,
      [SYSTEM_EMAIL],
    );
    if (!r) throw new Error('Compte « Treasure Hunters » indisponible (pseudo déjà pris ?).');
    return r['htr_id'];
  }

  /* ================================================================ Contrôles d'accès */

  private async visibleHunt(db: Db, viewer: Viewer, id: number): Promise<Hunt> {
    const hunt = await huntById(db, id);
    if (!hunt || (hunt.status === 'draft' && hunt.ownerId !== viewer)) throw notFound('Chasse introuvable.');
    return hunt;
  }

  private async ownedHunt(db: Db, viewer: Viewer, id: number, lock = false): Promise<Hunt> {
    const me = requireUser(viewer);
    const hunt = await huntById(db, id, lock);
    if (!hunt || (hunt.status === 'draft' && hunt.ownerId !== me)) throw notFound('Chasse introuvable.');
    if (hunt.ownerId !== me) throw forbidden('Réservé à l’organisateur de la chasse.');
    return hunt;
  }

  private async joinableHunt(db: Db, huntId: number, me: number): Promise<Hunt> {
    const hunt = await huntById(db, huntId, true);
    if (!hunt || hunt.status === 'draft') throw notFound('Chasse introuvable.');
    if (hunt.status !== 'published' && !openToLateTeams(hunt)) throw conflict('Les inscriptions sont fermées.');
    if (hunt.ownerId === me) throw conflict('Vous organisez cette chasse.');
    if (await teamOf(db, huntId, me)) throw conflict('Vous êtes déjà inscrit à cette chasse.');
    return hunt;
  }

  private checkStructureEditable(hunt: Hunt): void {
    if (!['draft', 'published'].includes(hunt.status)) throw conflict('Le parcours ne peut plus être modifié une fois la course lancée.');
  }

  private checkHuntData(h: HuntInput): void {
    if (h.begin && h.end && Date.parse(h.end) <= Date.parse(h.begin)) throw badRequest('La clôture doit suivre le départ.');
    if (h.teamMin !== undefined && h.teamMax !== undefined && h.teamMax < h.teamMin) throw badRequest('Taille d’équipe incohérente.');
    if (h.startMode === 'staggered' && !h.interval) throw badRequest('Indiquez l’intervalle entre deux départs.');
  }

  /** Chasse surprise : quand toutes les équipes sont arrivées, elle se clôt et le podium s'affiche. */
  private async closeSurpriseIfAllArrived(db: Db, hunt: Hunt): Promise<void> {
    if (!hunt.surprise) return;
    const waiting = await one(db, 'SELECT 1 FROM th_teams WHERE tea_hunt_hun = $1 AND tea_finished IS NULL', [hunt.id]);
    if (waiting) return;
    await db.query(`UPDATE th_hunts SET hun_closed = now(), hun_status_hst = $2, hun_lastupdate = now() WHERE hun_id = $1`, [
      hunt.id,
      STATUS_IDS.closed,
    ]);
  }

  private async setStatus(db: Db, id: number, status: HuntStatus): Promise<void> {
    await db.query('UPDATE th_hunts SET hun_status_hst = $2, hun_lastupdate = now() WHERE hun_id = $1', [id, STATUS_IDS[status]]);
  }

  private async addTeam(db: Db, hunt: Hunt, name: string, owner: number, solo: boolean): Promise<Team> {
    const r = await one(
      db,
      `INSERT INTO th_teams (tea_hunt_hun, tea_name, tea_owner_htr, tea_joincode, tea_solo) VALUES ($1, $2, $3, $4, $5) RETURNING tea_id`,
      [hunt.id, name, owner, joinCode(), solo],
    );
    await db.query('INSERT INTO th_teamhunters (thr_team_tea, thr_hunt_hun, thr_hunter_htr) VALUES ($1, $2, $3)', [r!['tea_id'], hunt.id, owner]);
    return (await teamById(db, r!['tea_id']))!;
  }
}

function toJob(r: Row): GenerationJob {
  return {
    id: r['gen_id'],
    status: r['gen_status'],
    mode: r['gen_params']['mode'],
    huntId: r['gen_hunt_hun'],
    error: r['gen_error'],
    note: r['gen_note'] ?? null,
  };
}

/** Taille maximale d'une équipe dans une chasse surprise. */
const SURPRISE_TEAM_MAX = 6;

/** Chasse surprise « chacun son chrono » en cours : on peut encore s'y inscrire et partir. */
function openToLateTeams(hunt: Hunt): boolean {
  return hunt.surprise && hunt.selfPaced && hunt.status === 'running';
}

/** Le joueur peut-il donner un départ (celui de son équipe, ou celui de tous) ? */
function canSelfStart(hunt: Hunt, team: Team, me: number): boolean {
  if (!hunt.surprise) return false;
  if (hunt.selfPaced) return !team.started && (hunt.status === 'published' || hunt.status === 'running');
  return hunt.status === 'published' && hunt.hostId === me;
}

/** Photo reçue en « data URL » ou en base64 : format reconnu à ses octets, 6 Mo au plus. */
function decodeImage(image: string): StoredPhoto {
  const bytes = Buffer.from(image.replace(/^data:[^,]*,/, ''), 'base64');
  if (bytes.length > MAX_PHOTO_BYTES) throw badRequest('Photo trop lourde (6 Mo au plus).');
  const contentType = imageType(bytes);
  if (!contentType) throw badRequest('Envoyez une photo au format JPEG, PNG ou WebP.');
  return { bytes, contentType };
}

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/* ---------------------------------------------------------------- Catalogue (§ 13) */

/** Instantané publié : de quoi recréer la chasse (sans dates, équipes ni QR). */
interface CatalogContent {
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
}

function catalogContent(h: Hunt, steps: Step[]): CatalogContent {
  return {
    hunt: {
      name: h.name,
      description: h.description,
      location: h.location,
      award: h.award,
      startText: h.startText,
      startMode: h.startMode,
      interval: h.interval,
      hintPenalties: h.hintPenalties,
      skipPenalty: h.skipPenalty,
      teamGame: h.teamGame,
      teamMin: h.teamMin,
      teamMax: h.teamMax,
      validation: h.validation,
      geoRadius: h.geoRadius,
      contribution: Number(h.contribution),
    },
    steps: steps.map((s) => ({
      order: s.order,
      title: s.title,
      arrival: s.arrival,
      instructions: s.instructions,
      hints: s.hints,
      latitude: s.latitude === null ? null : Number(s.latitude),
      longitude: s.longitude === null ? null : Number(s.longitude),
      address: s.address,
    })),
  };
}

/** Empreinte du parcours et des règles de jeu (pas des textes de présentation ni du lot). */
function contentFingerprint(c: CatalogContent): string {
  const rules = { penalties: c.hunt.hintPenalties, skip: c.hunt.skipPenalty, validation: c.hunt.validation, radius: c.hunt.geoRadius };
  return createHash('sha256').update(JSON.stringify({ rules, steps: c.steps })).digest('hex');
}

/**
 * Parties qui comptent pour une version : la chasse qui l'a publiée, et les copies de la
 * version qui n'ont rien publié elles-mêmes (une copie modifiée et republiée compte pour
 * sa propre version).
 */
const ENTRY_HUNTS = `
  WITH eh AS (
    SELECT c.cat_id, c.cat_hunt_hun AS hun_id FROM th_catalog c WHERE c.cat_hunt_hun IS NOT NULL
    UNION
    SELECT h.hun_catalog_cat, h.hun_id FROM th_hunts h
    WHERE h.hun_catalog_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM th_catalog x WHERE x.cat_hunt_hun = h.hun_id)
  )`;

async function catalogEntries(db: Db, where: string, params: unknown[], order = 'c.cat_id DESC'): Promise<CatalogEntry[]> {
  const list = await rows(
    db,
    `${ENTRY_HUNTS},
     pl AS (
       SELECT eh.cat_id,
              count(DISTINCT h.hun_id) FILTER (WHERE h.hun_status_hst IN (${STATUS_IDS.closed}, ${STATUS_IDS.archived})) AS plays,
              avg(extract(epoch FROM t.tea_finished - t.tea_started) / 60) AS measured
       FROM eh JOIN th_hunts h ON h.hun_id = eh.hun_id
       LEFT JOIN th_teams t ON t.tea_hunt_hun = h.hun_id AND t.tea_finished IS NOT NULL AND t.tea_started IS NOT NULL
       GROUP BY eh.cat_id
     ),
     ra AS (
       SELECT eh.cat_id, count(*) AS n, avg(r.rat_stars) AS stars, avg(r.rat_riddles) AS riddles, avg(r.rat_route) AS route, avg(r.rat_mood) AS mood
       FROM eh JOIN th_ratings r ON r.rat_hunt_hun = eh.hun_id GROUP BY eh.cat_id
     )
     SELECT c.cat_id, c.cat_author_htr, a.htr_nickname AS author_nickname, c.cat_title, c.cat_summary, c.cat_location, c.cat_difficulty,
            c.cat_duration, c.cat_stepcount, c.cat_validation, c.cat_changes, c.cat_creation, c.cat_withdrawn,
            p.cat_id AS parent_id, p.cat_title AS parent_title, pa.htr_nickname AS parent_author,
            (SELECT count(*)::int FROM th_catalog v WHERE v.cat_parent_cat = c.cat_id AND v.cat_withdrawn IS NULL) AS version_count,
            coalesce(pl.plays, 0)::int AS plays, pl.measured, coalesce(ra.n, 0)::int AS rating_count, ra.stars, ra.riddles, ra.route, ra.mood
     FROM th_catalog c
     JOIN th_hunters a ON a.htr_id = c.cat_author_htr
     LEFT JOIN th_catalog p ON p.cat_id = c.cat_parent_cat
     LEFT JOIN th_hunters pa ON pa.htr_id = p.cat_author_htr
     LEFT JOIN pl ON pl.cat_id = c.cat_id
     LEFT JOIN ra ON ra.cat_id = c.cat_id
     WHERE ${where}
     ORDER BY ${order}
     LIMIT 200`,
    params,
  );
  const avg = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
  return list.map((r) => ({
    id: r['cat_id'],
    authorId: r['cat_author_htr'],
    authorNickname: r['author_nickname'],
    title: r['cat_title'],
    summary: r['cat_summary'],
    location: r['cat_location'],
    difficulty: r['cat_difficulty'],
    durationMinutes: r['cat_duration'],
    measuredMinutes: r['measured'] === null ? null : Math.round(Number(r['measured'])),
    stepCount: r['cat_stepcount'],
    validation: r['cat_validation'],
    plays: r['plays'],
    rating: { count: r['rating_count'], stars: avg(r['stars']), riddles: avg(r['riddles']), route: avg(r['route']), mood: avg(r['mood']) },
    parent: r['parent_id'] ? { id: r['parent_id'], title: r['parent_title'], authorNickname: r['parent_author'] } : null,
    versionCount: r['version_count'],
    changes: r['cat_changes'],
    published: (r['cat_creation'] as Date).toISOString(),
    withdrawn: !!r['cat_withdrawn'],
  }));
}

function toRating(r: Row): Rating {
  return {
    stars: r['rat_stars'],
    riddles: r['rat_riddles'],
    route: r['rat_route'],
    mood: r['rat_mood'],
    comment: r['rat_comment'],
    organizer: r['rat_organizer'],
  };
}

