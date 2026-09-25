/**
 * Logique métier de l'API (docs/conception.md § 3 à § 5). Les règles du jeu viennent de shared/rules.ts,
 * les mêmes que celles utilisées par les maquettes.
 */
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
  stepByToken,
  stepsOf,
  teamById,
  teamOf,
  teamsWhere,
  toHunter,
  validationsOfHunt,
} from './repo.js';
import { HuntGenerator } from './generation/generator.js';
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
  ) {}

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

  async updateMe(viewer: Viewer, data: { nickname?: string; email?: string }) {
    const me = requireUser(viewer);
    if (data.email) checkEmail(data.email);
    try {
      const r = await one(
        this.pool,
        `UPDATE th_hunters SET htr_nickname = coalesce($2, htr_nickname), htr_email = coalesce($3, htr_email), htr_lastupdate = now()
         WHERE htr_id = $1 RETURNING *`,
        [me, data.nickname?.trim() ?? null, data.email?.trim() ?? null],
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
    return changed + (closed.rowCount ?? 0);
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
      if (hunt.status !== 'published') throw conflict('La chasse a déjà commencé.');
      await db.query('DELETE FROM th_teamhunters WHERE thr_team_tea = $1 AND thr_hunter_htr = $2', [team.id, me]);
      const rest = team.members.filter((m) => m.hunterId !== me);
      if (rest.length === 0) await db.query('DELETE FROM th_teams WHERE tea_id = $1', [team.id]);
      else if (team.ownerId === me) await db.query('UPDATE th_teams SET tea_owner_htr = $2 WHERE tea_id = $1', [team.id, rest[0].hunterId]);
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
        // Chasse surprise : le seul joueur est arrivé, la chasse se clôt et le résultat s'affiche.
        if (hunt.surprise) {
          await db.query(`UPDATE th_hunts SET hun_closed = now(), hun_status_hst = $2, hun_lastupdate = now() WHERE hun_id = $1`, [
            hunt.id,
            STATUS_IDS.closed,
          ]);
        }
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

  /** Chasse surprise : le joueur donne lui-même le départ, quand il est prêt (§ 11.4). */
  async selfStart(viewer: Viewer, huntId: number): Promise<PlayState> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const hunt = await huntById(db, huntId, true);
      if (!hunt || !(await teamOf(db, huntId, me))) throw notFound('Chasse introuvable.');
      if (!hunt.surprise) throw forbidden('Le départ est donné par l’organisateur.');
      if (hunt.status !== 'published') throw conflict('Cette chasse est déjà partie.');
      await this.start(db, hunt);
      return this.playState(db, me, huntId);
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
    const validated = vals
      .map((v) => {
        const s = steps.find((x) => x.id === v.stepId)!;
        return { order: s.order, title: s.title, arrival: s.arrival, at: v.at, skipped: v.source === 'SKIP' };
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
      selfStart: hunt.surprise && hunt.status === 'published',
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
      };
    });
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
      const { plan, location } = await this.generator!.generate(req);
      await tx(this.pool, async (db) => {
        const huntId = await this.createFromPlan(db, me, req, plan, location);
        await db.query(`UPDATE th_generations SET gen_status = 'done', gen_hunt_hun = $2, gen_lastupdate = now() WHERE gen_id = $1`, [
          jobId,
          huntId,
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
   * par le compte système, le joueur inscrit en solo donne lui-même le départ. Mode
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
                             hun_validation, hun_georadius, hun_generated, hun_surprise)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, true, $8, $9, 1, 2, 5, 10, 15, $10, 1, $11, false, $12, 'geo', 40, true, $13)
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
        !play,
        play ? 1 : 6,
        STATUS_IDS[play ? 'published' : 'draft'],
        play,
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
      await this.addTeam(db, (await huntById(db, huntId))!, nickname, me, true);
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
    if (hunt.status !== 'published') throw conflict('Les inscriptions sont fermées.');
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
  };
}
