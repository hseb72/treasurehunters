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
  AutonomyLeaderboard,
  HuntStats,
  ReportCategory,
  StepReport,
  AutonomyRow,
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
  PhotoShow,
  Difficulty,
  Travel,
  StoreItem,
  CompassReading,
  PuzzleResult,
  Souvenir,
  Challenge,
} from '../../shared/models.js';
import { sketchTrail } from '../../shared/souvenir.js';
import { PracticalTag } from '../../shared/practical.js';
import { ExplorerJournal, explorerJournal, JournalHunt } from '../../shared/journal.js';
import { DEFAULT_SKIN } from '../../shared/skins.js';
import { compassReading, DEFAULT_TOOLS, owns, PRODUCTS, productById, TOOL_IDS } from '../../shared/store.js';
import { acceptedAnswers, checkAnswer, publicPuzzle, Puzzle, puzzleProblem, puzzleType } from '../../shared/puzzles.js';
import { OfflineEvent, offlineHash, OfflinePack, OfflineSyncResult } from '../../shared/offline.js';
import {
  arrivalCheck,
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
import { creationProducts, Creations, publishedCreation } from './creations.js';
import { creationProductId, creationRef, samePuzzle } from '../../shared/creations.js';
import { catalogProductId, Payments } from './payments/payments.js';
import { generationAccess } from './generation/access.js';
import { PlayData, stepStats } from '../../shared/step-stats.js';
import { GENERATION_LIMITS, GenerationAccess } from '../../shared/generation-access.js';
import { PhotoJudge } from './photos/judge.js';
import { imageType, PhotoStore, StoredPhoto } from './photos/store.js';
import { HuntPlan } from '../../shared/generation.js';
import { AssistReply, AssistRequest, AssistUsage } from '../../shared/assist.js';
import { RiddleWriter } from './assist/writer.js';
import { assistUsageOf } from './assist/usage.js';
import { Translator } from './translate/translator.js';

export type Viewer = number | null;
export type HuntScope = 'public' | 'playing' | 'organized';
export type HuntAction = 'publish' | 'unpublish' | 'start' | 'close' | 'cancel';
export type HuntInput = Partial<
  Omit<Hunt, 'id' | 'ownerId' | 'ownerNickname' | 'status' | 'started' | 'closed' | 'joinCode' | 'stepCount' | 'teamCount' | 'generated' | 'surprise'>
>;
export type StepInput = Partial<Pick<Step, 'title' | 'arrival' | 'instructions' | 'hints' | 'address' | 'latitude' | 'longitude' | 'puzzle' | 'photoShow'>>;

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
  /** Créations de la communauté (§ 19). */
  readonly creations: Creations;
  /** Paiement (§ 20) : posé par l'application ; inactif sans Stripe. */
  payments: Payments | null = null;
  /** Assistant de rédaction (§ 25) ; null sans clé d'API. */
  writer: RiddleWriter | null = null;
  /** Traduction des chasses (§ 33) ; null sans clé d'API (seul le cache sert). */
  translator: Translator | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly generator: HuntGenerator | null = null,
    private readonly log: (err: unknown, msg: string) => void = () => {},
    /** Preuve par photo (§ 12) : stockage et arbitre IA ; null si le stockage n'est pas configuré. */
    private readonly photos: { store: PhotoStore; judge: PhotoJudge | null } | null = null,
  ) {
    this.creations = new Creations(pool);
  }

  /** Fonctions activées sur ce serveur, pour que le front n'affiche que ce qui marche. */
  features(): Features {
    return { photos: !!this.photos, generation: !!this.generator, payments: !!this.payments?.enabled, assist: !!this.writer, translation: !!this.translator };
  }

  /* ================================================================ Assistant de rédaction (§ 25) */

  async assistUsage(viewer: Viewer): Promise<AssistUsage> {
    return assistUsageOf(this.pool, requireUser(viewer));
  }

  /**
   * Suggestion de l'IA pour l'énigme d'une étape, d'après le texte en cours d'écriture (pas
   * forcément enregistré). La suggestion est réservée avant l'appel, et rendue s'il échoue :
   * seules les propositions reçues comptent.
   */
  async assist(viewer: Viewer, stepId: number, req: AssistRequest): Promise<AssistReply> {
    const me = requireUser(viewer);
    const writer = this.writer;
    if (!writer) throw new HttpError(503, 'L’assistant de rédaction n’est pas disponible sur ce serveur.');
    const step = await stepById(this.pool, stepId);
    if (!step) throw notFound('Étape introuvable.');
    const hunt = await this.ownedHunt(this.pool, viewer, step.huntId);
    const steps = await stepsOf(this.pool, hunt.id);
    const target = steps.find((s) => s.order === step.order + 1);
    if (!target) throw badRequest('L’arrivée n’a pas d’énigme : il n’y a plus de lieu à trouver.');
    const instructions = req.instructions.trim();
    if (!instructions && req.action !== 'rephrase') throw badRequest('Écrivez d’abord une première version de l’énigme.');
    const reserved = await tx(this.pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(7325, $1)', [me]);
      const usage = await assistUsageOf(db, me);
      if (usage.blocked) throw new HttpError(429, usage.blocked);
      return (await one(db, 'INSERT INTO th_assists (ass_hunter_htr, ass_hunt_hun, ass_action) VALUES ($1, $2, $3) RETURNING ass_id', [me, hunt.id, req.action]))!['ass_id'] as number;
    });
    try {
      const suggestion = await writer.assist({
        action: req.action,
        hunt: { name: hunt.name, location: hunt.location, difficulty: hunt.difficulty, travel: hunt.travel },
        from: step.order === 0 ? null : { title: step.title, address: step.address },
        target: { title: target.title, address: target.address, arrival: target.arrival },
        instructions,
        hints: req.hints.map((h) => h.trim()).filter(Boolean),
      });
      return { suggestion, usage: await assistUsageOf(this.pool, me) };
    } catch (e) {
      await this.pool.query('DELETE FROM th_assists WHERE ass_id = $1', [reserved]);
      this.log(e, `Assistant de rédaction (étape ${stepId})`);
      throw new HttpError(502, 'L’assistant n’a pas pu répondre : réessayez dans un instant. Cette demande n’est pas décomptée.');
    }
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
      await this.checkExtensions(db, me, data, null);
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
      await this.checkExtensions(db, requireUser(viewer), data, hunt);
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
          if (hunt.stepCount < 1) throw conflict('Ajoutez au moins une étape avant d’ouvrir les inscriptions.');
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
      await this.checkPuzzle(db, requireUser(viewer), (await stepById(db, r!['cod_id']))!, data);
      return this.writeStep(db, r!['cod_id'], data);
    });
  }

  async updateStep(viewer: Viewer, stepId: number, data: StepInput): Promise<Step> {
    return tx(this.pool, async (db) => {
      const step = await stepById(db, stepId);
      if (!step) throw notFound('Étape introuvable.');
      const hunt = await this.ownedHunt(db, viewer, step.huntId);
      if (['closed', 'cancelled', 'archived'].includes(hunt.status)) throw conflict('Cette expédition ne peut plus être modifiée.');
      await this.checkPuzzle(db, requireUser(viewer), step, data);
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
    // Déplacer l'étape, c'est changer de lieu : les entrées de l'ancien ne valent plus.
    if (data.latitude !== undefined || data.longitude !== undefined) {
      const before = (await stepById(db, id))!;
      const moved = (data.latitude !== undefined && Number(data.latitude) !== Number(before.latitude)) || (data.longitude !== undefined && Number(data.longitude) !== Number(before.longitude));
      if (moved) cols.push(['cod_entrances', null]);
    }
    if (data.puzzle !== undefined) cols.push(['cod_puzzle', data.puzzle ? JSON.stringify(data.puzzle) : null]);
    if (data.photoShow !== undefined) cols.push(['cod_photoshow', data.photoShow]);
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
      await db.query('DELETE FROM th_arrivals WHERE arr_team_tea = $1 AND arr_code_cod = $2', [team.id, target.id]);
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
      // Le lieu, ou l'une de ses entrées : la plus proche compte.
      const check = arrivalCheck(target, hunt, pos);
      if (!check) throw conflict('Ce lieu n’est pas placé sur la carte : prévenez l’organisateur.');
      const { distance, allowed } = check;
      const outcome = check.ok ? 'validated' : 'too_far';
      await db.query(
        'INSERT INTO th_scanlog (scl_code_cod, scl_token, scl_hunter_htr, scl_team_tea, scl_result, scl_ip) VALUES ($1, $2, $3, $4, $5, $6)',
        [target.id, `geo:${target.id}`, me, team.id, outcome, ip ?? null],
      );
      if (outcome === 'too_far') return { outcome, distance, allowed, step: null, state };

      const final = finalOrder(steps);
      // Étape à énigme : l'équipe est sur place, l'énigme l'attend (§ 17).
      if ((await this.arrive(db, team.id, target, me, 'GEO')) === 'puzzle') {
        return { outcome: 'puzzle', distance, allowed, step: null, state: await this.playState(db, me, huntId) };
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

  /* ================================================================ Version anglaise (§ 33) */

  /**
   * Traductions des textes qu'un joueur voit : fiches du catalogue, et dans sa partie ce que
   * son carnet montre déjà (jamais les énigmes ni les lieux à venir). Chaque texte n'est
   * traduit qu'une fois (cache th_translations) ; sans IA, seul le cache répond.
   */
  async translate(viewer: Viewer, req: { lang: 'en'; hunt?: number; catalog?: number[] }): Promise<Record<string, string>> {
    const texts = new Set<string>();
    const add = (t: string | null | undefined) => {
      const v = t?.trim();
      if (v && v.length <= 5000) texts.add(v);
    };
    if (req.catalog?.length) {
      const list = await rows(
        this.pool,
        `SELECT cat_title, cat_summary, cat_sample, cat_location FROM th_catalog WHERE cat_id = ANY($1) AND (cat_withdrawn IS NULL OR cat_author_htr = $2)`,
        [req.catalog.slice(0, 30), viewer],
      );
      for (const r of list) [r['cat_title'], r['cat_summary'], r['cat_sample'], r['cat_location']].forEach(add);
    }
    if (req.hunt) {
      const state = await this.playState(this.pool, requireUser(viewer), req.hunt);
      [state.hunt.name, state.hunt.location, state.hunt.description, state.hunt.startText, state.start?.name].forEach(add);
      for (const v of state.validated) [v.title, v.arrival].forEach(add);
      if (state.clue) [state.clue.instructions, ...state.clue.hintsRevealed].forEach(add);
      if (state.puzzle) [state.puzzle.title, state.puzzle.puzzle.prompt, state.puzzle.puzzle.hint].forEach(add);
    }
    const all = [...texts].slice(0, 120);
    if (!all.length) return {};
    const hashes = all.map((t) => createHash('sha256').update(t).digest('hex'));
    const cached = await rows(this.pool, 'SELECT tr_hash, tr_text FROM th_translations WHERE tr_lang = $1 AND tr_hash = ANY($2)', [req.lang, hashes]);
    const known = new Map(cached.map((r) => [r['tr_hash'] as string, r['tr_text'] as string]));
    const missing = all.filter((_, i) => !known.has(hashes[i]!));
    if (missing.length && this.translator) {
      try {
        for (let i = 0; i < missing.length; i += 40) {
          const batch = missing.slice(i, i + 40);
          const out = await this.translator.translate(batch, req.lang);
          for (const [j, text] of batch.entries()) {
            const hash = createHash('sha256').update(text).digest('hex');
            known.set(hash, out[j]!);
            await this.pool.query('INSERT INTO th_translations (tr_lang, tr_hash, tr_text) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [req.lang, hash, out[j]]);
          }
        }
      } catch (e) {
        this.log(e, 'Traduction');
      }
    }
    const result: Record<string, string> = {};
    all.forEach((t, i) => {
      const tr = known.get(hashes[i]!);
      if (tr) result[t] = tr;
    });
    return result;
  }

  /* ================================================================ Hors ligne (§ 32) */

  /**
   * Paquet hors ligne : le parcours restant de l'équipe (énigmes, jokers, positions, empreintes
   * des QR et des réponses) et sa progression, pour continuer sans réseau.
   */
  async offlinePack(viewer: Viewer, huntId: number): Promise<OfflinePack> {
    const me = requireUser(viewer);
    const hunt = await this.visibleHunt(this.pool, me, huntId);
    const team = await teamOf(this.pool, huntId, me);
    if (!team) throw forbidden('Vous n’êtes pas inscrit à cette chasse.');
    if (hunt.status !== 'published' && hunt.status !== 'running') throw conflict('Cette expédition n’est pas en cours.');
    if (!team.started && !(hunt.surprise && hunt.selfPaced)) throw conflict('Préparez le hors ligne une fois le départ donné.');
    const steps = await stepsOf(this.pool, huntId);
    const vals = (await validationsOfHunt(this.pool, huntId)).filter((v) => v.teamId === team.id);
    const hints = (await hintUsesOfHunt(this.pool, huntId)).filter((u) => u.teamId === team.id);
    const pending = await one(this.pool, 'SELECT arr_code_cod, arr_attempts FROM th_arrivals WHERE arr_team_tea = $1 LIMIT 1', [team.id]);
    const packed = await Promise.all(
      steps.map(async (s) => ({
        stepId: s.id,
        order: s.order,
        title: s.title,
        arrival: s.arrival,
        instructions: s.instructions,
        hints: s.hints,
        lat: s.latitude === null ? null : Number(s.latitude),
        lng: s.longitude === null ? null : Number(s.longitude),
        entrances: s.entrances,
        tokenHash: hunt.validation === 'qr' && s.order > 0 && s.token ? await offlineHash(s.id, s.token) : null,
        puzzle: s.puzzle ? publicPuzzle(s.puzzle, s.id) : null,
        answerHashes: s.puzzle ? await Promise.all(acceptedAnswers(s.puzzle).map((a) => offlineHash(s.id, a))) : null,
      })),
    );
    const hintCount: Record<number, number> = {};
    for (const u of hints) hintCount[u.stepId] = Math.max(hintCount[u.stepId] ?? 0, u.level);
    return {
      huntId,
      huntName: hunt.name,
      skin: hunt.skin,
      teamName: team.name,
      validation: hunt.validation,
      geoRadius: hunt.geoRadius,
      selfStart: canSelfStart(hunt, team, me) && hunt.selfPaced,
      steps: packed,
      progress: {
        started: team.started,
        validated: vals
          .map((v) => ({ order: steps.find((s) => s.id === v.stepId)!.order, at: v.at, skipped: v.source === 'SKIP' }))
          .sort((a, b) => a.order - b.order),
        hints: hintCount,
        puzzle: pending ? { stepId: pending['arr_code_cod'], attempts: pending['arr_attempts'] } : null,
      },
      downloaded: new Date().toISOString(),
    };
  }

  /**
   * Retour du réseau : les actions jouées hors ligne sont rejouées dans l'ordre, à leur heure
   * réelle, avec les mêmes vérifications qu'en ligne (position, QR, réponse). La première
   * refusée arrête le rejeu ; une action déjà rejouée (même identifiant) est ignorée.
   */
  async offlineSync(viewer: Viewer, huntId: number, events: OfflineEvent[]): Promise<OfflineSyncResult & { state: PlayState }> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const mine = await teamOf(db, huntId, me);
      if (!mine) throw forbidden('Vous n’êtes pas inscrit à cette chasse.');
      await teamById(db, mine.id, true); // sérialisé avec les scans de l'équipe
      const now = ((await one(db, 'SELECT now() AS now'))!['now'] as Date).getTime();
      let applied = 0;
      let previous = 0;
      let rejected: OfflineSyncResult['rejected'] = null;
      for (const [index, e] of events.entries()) {
        if (await one(db, 'SELECT 1 FROM th_offline WHERE off_team_tea = $1 AND off_event = $2', [mine.id, e.id])) {
          applied++;
          continue;
        }
        const at = Date.parse(e.at);
        let reason: string | null = null;
        if (!Number.isFinite(at) || at > now + 120_000) reason = 'Heure invalide (horloge du téléphone ?).';
        else if (at < previous) reason = 'Actions dans le désordre.';
        else reason = await this.replayOffline(db, me, huntId, e, new Date(at));
        if (reason) {
          rejected = { index, reason };
          break;
        }
        previous = at;
        await db.query('INSERT INTO th_offline (off_team_tea, off_event, off_kind, off_at, off_hunter_htr) VALUES ($1, $2, $3, $4, $5)', [
          mine.id,
          e.id,
          e.kind,
          new Date(at),
          me,
        ]);
        applied++;
      }
      return { applied, rejected, state: await this.playState(db, me, huntId) };
    });
  }

  /** Une action hors ligne, rejouée ; renvoie la raison d'un refus, ou null. */
  private async replayOffline(db: Db, me: number, huntId: number, e: OfflineEvent, at: Date): Promise<string | null> {
    const hunt = (await huntById(db, huntId))!;
    const team = (await teamOf(db, huntId, me))!;
    if (e.kind === 'start') {
      if (!canSelfStart(hunt, team, me) || !hunt.selfPaced) return 'Le départ ne se donne pas depuis ce téléphone.';
      if (hunt.status === 'published') {
        await db.query('UPDATE th_hunts SET hun_started = $2, hun_status_hst = $3, hun_lastupdate = now() WHERE hun_id = $1', [huntId, at, STATUS_IDS.running]);
      }
      await db.query('UPDATE th_teams SET tea_started = $2, tea_lastupdate = now() WHERE tea_id = $1', [team.id, at]);
      return null;
    }
    if (!team.started || at.getTime() < Date.parse(team.started)) return 'Action antérieure au départ de l’équipe.';
    const state = await this.playState(db, me, huntId);
    const steps = await stepsOf(db, huntId);
    const clue = state.clue;
    const target = clue ? steps.find((s) => s.order === clue.targetOrder)! : null;
    switch (e.kind) {
      case 'hint': {
        if (!clue || clue.stepId !== e.stepId) return 'Ce joker ne correspond pas à l’énigme en cours.';
        if (clue.hintsRevealed.length >= clue.hintsTotal) return 'Tous les jokers étaient déjà pris.';
        await db.query('INSERT INTO th_hintuses (hiu_team_tea, hiu_code_cod, hiu_level, hiu_hunter_htr, hiu_creation) VALUES ($1, $2, $3, $4, $5)', [
          team.id,
          clue.stepId,
          clue.hintsRevealed.length + 1,
          me,
          at,
        ]);
        return null;
      }
      case 'skip': {
        if (!clue || !target || target.id !== e.stepId) return 'Cet abandon ne correspond pas à l’épreuve en cours.';
        if (!clue.canSkip) return 'L’arrivée ne peut pas être abandonnée.';
        await db.query(`INSERT INTO th_validations (val_team_tea, val_code_cod, val_hunter_htr, val_source, val_creation) VALUES ($1, $2, $3, 'SKIP', $4)`, [
          team.id,
          target.id,
          me,
          at,
        ]);
        await db.query('DELETE FROM th_arrivals WHERE arr_team_tea = $1 AND arr_code_cod = $2', [team.id, target.id]);
        return null;
      }
      case 'arrive':
      case 'scan': {
        if (!target || target.id !== e.stepId || state.puzzle) return 'Cette arrivée ne correspond pas au lieu cherché.';
        let ok: boolean;
        if (e.kind === 'arrive') {
          if (hunt.validation !== 'geo') return 'Cette chasse se valide avec les QR codes.';
          const check = arrivalCheck(target, hunt, e);
          ok = !!check?.ok;
          if (!ok) {
            await this.logOffline(db, target.id, `geo:${target.id}`, me, team.id, 'too_far');
            return `Position trop loin du lieu (${check?.distance ?? '?'} m).`;
          }
        } else {
          ok = !!target.token && e.token === target.token;
          if (!ok) return 'Ce QR code n’est pas celui du lieu cherché.';
        }
        await this.logOffline(db, target.id, e.kind === 'arrive' ? `geo:${target.id}` : e.token, me, team.id, 'validated');
        await this.arrive(db, team.id, target, me, e.kind === 'arrive' ? 'GEO' : 'QR', null, at);
        return null;
      }
      case 'answer': {
        if (!state.puzzle || state.puzzle.stepId !== e.stepId) return 'Aucune épreuve n’attendait cette réponse.';
        const step = steps.find((s) => s.id === e.stepId)!;
        if (!checkAnswer(step.puzzle!, e.answer)) return 'Réponse à l’épreuve refusée.';
        const arrival = (await one(db, 'SELECT * FROM th_arrivals WHERE arr_team_tea = $1 AND arr_code_cod = $2', [team.id, step.id]))!;
        await db.query('DELETE FROM th_arrivals WHERE arr_id = $1', [arrival['arr_id']]);
        await this.recordValidation(db, team.id, step, me, arrival['arr_source'], arrival['arr_photo_pho'], at);
        return null;
      }
    }
  }

  private async logOffline(db: Db, stepId: number, token: string, me: number, teamId: number, result: string): Promise<void> {
    await db.query('INSERT INTO th_scanlog (scl_code_cod, scl_token, scl_hunter_htr, scl_team_tea, scl_result, scl_ip) VALUES ($1, $2, $3, $4, $5, $6)', [
      stepId,
      `hl:${token}`.slice(0, 64), // « hl: » : rejoué au retour du réseau
      me,
      teamId,
      result,
      null,
    ]);
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
      const stepInfo = { order: step!.order, title: step!.title, arrival: step!.arrival, isFinal: step!.order === final, illustration: this.illustration(step!, 'arrival') };

      if (outcome === 'validated') {
        // Étape à énigme : le scan prouve l'arrivée ; l'étape se valide en résolvant l'énigme (§ 17).
        if ((await this.arrive(db, team!.id, step!, viewer!, 'QR', null, now)) === 'puzzle') {
          result.outcome = 'puzzle';
          result.step = { ...stepInfo, arrival: null, illustration: null };
          return result;
        }
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
              illustration: this.illustration(steps.find((s) => s.order === step!.order + 1), 'clue'),
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
        return {
          order: s.order,
          title: s.title,
          arrival: s.arrival,
          at: v.at,
          skipped: v.source === 'SKIP',
          photo: photoReviews.get(s.id) ?? null,
          illustration: this.illustration(s, 'arrival'),
        };
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
        illustration: this.illustration(steps.find((s) => s.order === current.order + 1), 'clue'),
      };
    }

    // Énigme d'arrivée : l'équipe est sur le lieu cherché, l'étape attend la bonne réponse (§ 17).
    let puzzle: PlayState['puzzle'] = null;
    if (clue) {
      const target = steps.find((s) => s.order === clue!.targetOrder);
      const arrival = target?.puzzle ? await one(db, 'SELECT * FROM th_arrivals WHERE arr_team_tea = $1 AND arr_code_cod = $2', [team.id, target.id]) : null;
      if (target?.puzzle && arrival) {
        const view = publicPuzzle(target.puzzle, target.id);
        puzzle = {
          stepId: target.id,
          order: target.order,
          title: target.title,
          puzzle: { ...view, hint: arrival['arr_hint'] ? view.hint : null },
          hasHint: !!view.hint,
          attempts: arrival['arr_attempts'],
          hintShown: arrival['arr_hint'],
        };
      }
    }

    // Position provisoire : les joueurs ne voient que celle de leur équipe (§ 5.3).
    let position: PlayState['position'] = null;
    if (hunt.status === 'running' && team.started && hunt.tools.includes('live')) {
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
      start: startOf(steps),
      puzzle,
      // Outil Carte : seulement les lieux que l'équipe a déjà trouvés.
      trail: hunt.tools.includes('map')
        ? validated
            .filter((v) => !v.skipped)
            .map((v) => steps.find((x) => x.order === v.order)!)
            .filter((x) => x.latitude !== null && x.longitude !== null)
            .map((x) => ({ order: x.order, title: x.title, lat: Number(x.latitude), lng: Number(x.longitude) }))
        : null,
    };
  }

  /** Carnet d'explorateur (§ 29) : les chasses finies du joueur, ses villes, ses kilomètres et ses badges. */
  async journal(viewer: Viewer): Promise<ExplorerJournal> {
    const me = requireUser(viewer);
    const finished = await rows(
      this.pool,
      `SELECT t.tea_id, t.tea_hunt_hun FROM th_teams t JOIN th_teamhunters m ON m.thr_team_tea = t.tea_id
       WHERE m.thr_hunter_htr = $1 AND t.tea_finished IS NOT NULL AND t.tea_started IS NOT NULL
       ORDER BY t.tea_finished DESC LIMIT 200`,
      [me],
    );
    const hunts: JournalHunt[] = [];
    for (const f of finished) {
      const hunt = await huntById(this.pool, f['tea_hunt_hun']);
      if (!hunt) continue;
      const teams = await teamsWhere(this.pool, 't.tea_hunt_hun = $1', [hunt.id]);
      const vals = await validationsOfHunt(this.pool, hunt.id);
      const row = computeRanking(hunt, teams, vals, await hintUsesOfHunt(this.pool, hunt.id)).find((r) => r.teamId === f['tea_id']);
      if (!row?.time || !row.started) continue;
      const steps = await stepsOf(this.pool, hunt.id);
      const found = vals.filter((v) => v.teamId === f['tea_id'] && v.source !== 'SKIP').map((v) => steps.find((s) => s.id === v.stepId)!);
      const places = [steps.find((s) => s.order === 0), ...found.sort((a, b) => a.order - b.order)]
        .filter((s): s is Step => !!s && s.latitude !== null && s.longitude !== null)
        .map((s) => ({ lat: Number(s.latitude), lng: Number(s.longitude) }));
      const meters = places.slice(1).reduce((a, p, i) => a + distanceMeters(places[i]!, p), 0);
      hunts.push({
        huntId: hunt.id,
        name: hunt.name,
        location: hunt.location,
        skin: hunt.skin,
        date: row.started,
        time: row.time,
        found: found.length,
        hints: row.hints,
        autonomous: hunt.surprise && hunt.hostId !== null && hunt.catalogId !== null,
        catalogId: hunt.catalogId,
        km: Math.round(meters / 100) / 10,
      });
    }
    return explorerJournal(hunts);
  }

  /**
   * Souvenir de fin de partie (§ 24) : ce qu'il faut pour dessiner la carte d'une équipe
   * arrivée. Le rang est celui de la chasse, ou celui de tous les joueurs de la version du
   * catalogue pour une partie en autonomie ; pendant la course, seulement avec l'outil Direct.
   */
  async souvenir(viewer: Viewer, huntId: number): Promise<Souvenir> {
    const me = requireUser(viewer);
    const hunt = await this.visibleHunt(this.pool, me, huntId);
    const team = await teamOf(this.pool, huntId, me);
    if (!team) throw forbidden('Vous n’êtes pas inscrit à cette chasse.');
    if (!team.finished || !team.started) throw conflict('Le souvenir sera prêt à l’arrivée de votre équipe.');
    const steps = await stepsOf(this.pool, huntId);
    const ranking = await this.ranking(this.pool, hunt);
    const row = ranking.find((r) => r.teamId === team.id)!;
    let rank: number | null = null;
    let ranked = 0;
    let scope: Souvenir['scope'] = 'hunt';
    if (hunt.surprise && hunt.hostId !== null && hunt.catalogId !== null) {
      const board = await this.autonomyLeaderboard(me, hunt.catalogId);
      scope = 'catalog';
      ranked = board.finishers;
      rank = board.rows.find((r) => r.mine && r.finished === team.finished)?.rank ?? null;
    } else if (hunt.status !== 'running' || hunt.tools.includes('live')) {
      ranked = ranking.filter((r) => r.rank !== null).length;
      rank = row.rank;
    }
    const vals = (await validationsOfHunt(this.pool, huntId)).filter((v) => v.teamId === team.id);
    const found = vals.filter((v) => v.source !== 'SKIP').map((v) => steps.find((s) => s.id === v.stepId)!);
    const places = [steps.find((s) => s.order === 0), ...found.sort((a, b) => a.order - b.order)]
      .filter((s): s is Step => !!s && s.latitude !== null && s.longitude !== null)
      .map((s) => ({ lat: Number(s.latitude), lng: Number(s.longitude) }));
    return {
      huntId,
      huntName: hunt.name,
      skin: hunt.skin,
      location: hunt.location,
      date: team.started,
      teamName: team.name,
      members: team.members.map((m) => m.nickname),
      time: row.time ?? 0,
      penalty: row.penalty / 60,
      rank: ranked > 1 ? rank : null,
      ranked,
      scope,
      provisional: scope === 'hunt' && hunt.status === 'running',
      found: found.length,
      skipped: row.skips,
      totalSteps: finalOrder(steps),
      hints: row.hints,
      trail: sketchTrail(places),
      catalogId: hunt.catalogId,
    };
  }

  /* ================================================================ Boutique (§ 16) */

  private async ownedProducts(db: Db, me: number | null): Promise<Set<string>> {
    if (me === null) return new Set();
    const list = await rows(db, 'SELECT pur_product FROM th_purchases WHERE pur_hunter_htr = $1', [me]);
    return new Set(list.map((r) => r['pur_product'] as string));
  }

  async store(viewer: Viewer): Promise<StoreItem[]> {
    const owned = await this.ownedProducts(this.pool, viewer);
    return [...PRODUCTS.map((p) => ({ ...p, owned: owns(owned, p.id) })), ...(await creationProducts(this.pool, owned, viewer))];
  }

  /** Obtenir une extension : offerte tant que le paiement n'est pas branché. */
  async acquire(viewer: Viewer, productId: string): Promise<StoreItem[]> {
    const me = requireUser(viewer);
    const ref = creationRef(productId);
    const creation = ref !== null ? await publishedCreation(this.pool, ref) : null;
    // Création de la communauté : publiée, et du genre annoncé (« skin:u12 » pour un skin).
    const product = creation && productId === creationProductId(creation.kind, creation.id) ? { id: productId, included: false } : productById(productId);
    if (!product) throw notFound('Extension inconnue.');
    // Paiement activé : un produit payant s'achète (checkout) ; gratuit, il s'obtient ici.
    if (this.payments?.enabled && !product.included) {
      const item = await this.payments.sellable(productId);
      if (item && item.price > 0 && item.sellerId !== me) throw new HttpError(402, 'Ce produit est payant : passez par le paiement.');
    }
    if (!product.included) {
      await this.pool.query('INSERT INTO th_purchases (pur_hunter_htr, pur_product, pur_price) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING', [me, product.id]);
    }
    return this.store(me);
  }

  /**
   * Un organisateur n'installe que les univers et outils qu'il possède. Ce qu'une chasse a
   * déjà (copie du catalogue, chasse d'avant la boutique) reste permis.
   */
  private async checkExtensions(db: Db, me: number, data: Partial<Hunt>, current: Hunt | null): Promise<void> {
    const wanted = [
      ...(data.skin !== undefined && data.skin !== current?.skin ? [`skin:${data.skin}`] : []),
      ...(data.tools ?? []).filter((t) => !current?.tools.includes(t)).map((t) => `tool:${t}`),
    ];
    if (!wanted.length) return;
    const owned = await this.ownedProducts(db, me);
    for (const id of wanted) {
      const ref = creationRef(id);
      if (ref !== null) {
        // Skin de créateur : publié, et obtenu (son auteur l'a d'office).
        const c = await publishedCreation(db, ref);
        if (!c || creationProductId(c.kind, c.id) !== id) throw badRequest('Ce skin n’existe pas ou n’est plus publié.');
        if (c.authorId !== me && !owned.has(id)) throw forbidden(`« ${c.name} » s’obtient d’abord dans la boutique.`);
        continue;
      }
      const p = productById(id);
      if (p && !owns(owned, p.id)) throw forbidden(`« ${p.name} » s’obtient d’abord dans la boutique.`);
    }
  }

  /** Outil Boussole : direction et fourchette de distance du prochain lieu, jamais sa position. */
  async compass(viewer: Viewer, huntId: number, pos: { lat: number; lng: number }): Promise<CompassReading> {
    const me = requireUser(viewer);
    const state = await this.playState(this.pool, me, huntId);
    if (!state.hunt.tools.includes('compass')) throw forbidden('Cette chasse n’a pas de boussole.');
    if (!state.clue) throw conflict('Aucune étape à trouver pour le moment.');
    const target = (await stepsOf(this.pool, huntId)).find((s) => s.order === state.clue!.targetOrder)!;
    if (target.latitude === null || target.longitude === null) throw conflict('Ce lieu n’est pas placé sur la carte : la boussole ne peut pas le trouver.');
    const to = { lat: Number(target.latitude), lng: Number(target.longitude) };
    return compassReading(pos, to, distanceMeters(pos, to));
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
      // L'organisateur tranche : une énigme d'arrivée en attente n'a plus lieu d'être.
      await db.query('DELETE FROM th_arrivals WHERE arr_team_tea = $1 AND arr_code_cod = $2', [teamId, stepId]);
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

  /**
   * Photo du lieu montrée aux joueurs (§ 18) : l'étape dont on peut demander l'image, ou null.
   * « clue » : dès l'énigme qui y mène ; « arrival » : une fois le lieu trouvé (une photo
   * montrée avec l'énigme l'est aussi à l'arrivée).
   */
  private illustration(step: Step | undefined, moment: PhotoShow): number | null {
    if (!this.photos || !step?.referencePhoto || !step.photoShow) return null;
    return moment === 'clue' && step.photoShow !== 'clue' ? null : step.id;
  }

  /** Image de la photo du lieu, pour l'organisateur ou une équipe à qui elle est montrée. */
  async illustrationImage(viewer: Viewer, stepId: number): Promise<StoredPhoto> {
    const photos = this.requirePhotos();
    const me = requireUser(viewer);
    const step = await stepById(this.pool, stepId);
    if (!step) throw notFound('Étape introuvable.');
    const hunt = await huntById(this.pool, step.huntId);
    let allowed = hunt?.ownerId === me;
    if (!allowed && step.photoShow && (await teamOf(this.pool, step.huntId, me))) {
      const state = await this.playState(this.pool, me, step.huntId);
      allowed =
        state.validated.some((v) => v.order === step.order && v.illustration === step.id) ||
        state.clue?.illustration === step.id;
    }
    const key = allowed && step.referencePhoto ? (await one(this.pool, 'SELECT cod_refphoto FROM th_codes WHERE cod_id = $1', [stepId]))!['cod_refphoto'] : null;
    const image = key ? await photos.store.get(key) : null;
    if (!image) throw notFound('Pas de photo à montrer pour cette étape.');
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
    await this.arrive(db, teamId, step, me, 'PHOTO', photoId);
  }

  /* ================================================================ Énigmes d'arrivée (§ 17) */

  /**
   * L'équipe est sur le lieu d'une étape (QR, géolocalisation, photo). Sans énigme, l'étape est
   * validée ; avec une énigme, l'arrivée est notée et l'étape attend la bonne réponse.
   */
  private async arrive(db: Db, teamId: number, step: Step, me: number, source: 'QR' | 'GEO' | 'PHOTO', photoId: number | null = null, at: Date | null = null): Promise<'validated' | 'puzzle'> {
    if (step.puzzle) {
      await db.query(
        `INSERT INTO th_arrivals (arr_team_tea, arr_code_cod, arr_hunter_htr, arr_source, arr_photo_pho) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (arr_team_tea, arr_code_cod) DO UPDATE SET arr_source = EXCLUDED.arr_source, arr_photo_pho = coalesce(EXCLUDED.arr_photo_pho, th_arrivals.arr_photo_pho)`,
        [teamId, step.id, me, source, photoId],
      );
      return 'puzzle';
    }
    await this.recordValidation(db, teamId, step, me, source, photoId, at);
    return 'validated';
  }

  private async recordValidation(db: Db, teamId: number, step: Step, me: number, source: 'QR' | 'GEO' | 'PHOTO', photoId: number | null, at: Date | null): Promise<void> {
    await db.query(
      `INSERT INTO th_validations (val_team_tea, val_code_cod, val_hunter_htr, val_source, val_photo_pho, val_creation) VALUES ($1, $2, $3, $4, $5, coalesce($6, now()))`,
      [teamId, step.id, me, source, photoId, at],
    );
    const steps = await stepsOf(db, step.huntId);
    if (step.order === finalOrder(steps)) {
      await db.query('UPDATE th_teams SET tea_finished = coalesce($2, now()) WHERE tea_id = $1', [teamId, at]);
      const hunt = (await huntById(db, step.huntId))!;
      await this.closeSurpriseIfAllArrived(db, hunt);
    }
  }

  /** Réponse à l'énigme d'arrivée : juste, l'étape est validée ; fausse, on peut réessayer. */
  async solvePuzzle(viewer: Viewer, huntId: number, answer: string): Promise<PuzzleResult> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const team = await teamOf(db, huntId, me);
      if (!team) throw forbidden('Vous n’êtes pas inscrit à cette chasse.');
      await teamById(db, team.id, true); // sérialisé avec les scans de l'équipe
      const state = await this.playState(db, me, huntId);
      if (!state.puzzle) throw conflict('Aucune énigme à résoudre : rendez-vous d’abord sur le lieu.');
      const steps = await stepsOf(db, huntId);
      const step = steps.find((s) => s.id === state.puzzle!.stepId)!;
      const arrival = (await one(db, 'SELECT * FROM th_arrivals WHERE arr_team_tea = $1 AND arr_code_cod = $2', [team.id, step.id]))!;
      if (!checkAnswer(step.puzzle!, answer)) {
        await db.query('UPDATE th_arrivals SET arr_attempts = arr_attempts + 1 WHERE arr_id = $1', [arrival['arr_id']]);
        return { correct: false, step: null, state: await this.playState(db, me, huntId) };
      }
      await db.query('DELETE FROM th_arrivals WHERE arr_id = $1', [arrival['arr_id']]);
      await this.recordValidation(db, team.id, step, me, arrival['arr_source'], arrival['arr_photo_pho'], null);
      const final = finalOrder(steps);
      return {
        correct: true,
        step: { order: step.order, title: step.title, arrival: step.arrival, isFinal: step.order === final },
        state: await this.playState(db, me, huntId),
      };
    });
  }

  /**
   * Une énigme d'arrivée se pose sur une étape du parcours (pas le départ), bien rédigée, d'un
   * type que l'organisateur possède (pack de la boutique) ou que l'étape avait déjà.
   */
  private async checkPuzzle(db: Db, me: number, step: Step, data: StepInput): Promise<void> {
    if (!data.puzzle) return;
    if (step.order === 0) throw badRequest('Le départ n’a pas d’énigme d’arrivée.');
    const problem = puzzleProblem(data.puzzle);
    if (problem) throw badRequest(problem);
    if (step.puzzle?.type === data.puzzle.type) return;
    const pack = productById(puzzleType(data.puzzle.type).pack)!;
    const owned = await this.ownedProducts(db, me);
    // Une énigme tirée d'un pack de créateur obtenu (§ 19) se pose sans le pack de son type.
    if (!owns(owned, pack.id) && !(await this.fromCreatorPack(db, owned, data.puzzle))) throw forbidden(`« ${puzzleType(data.puzzle.type).name} » vient du pack « ${pack.name} » : obtenez-le d’abord dans la boutique.`);
  }

  private async fromCreatorPack(db: Db, owned: ReadonlySet<string>, puzzle: Puzzle): Promise<boolean> {
    const ids = [...owned].map((id) => (id.startsWith('pack:') ? creationRef(id) : null)).filter((id): id is number => id !== null);
    if (!ids.length) return false;
    const packs = await rows(db, `SELECT cre_content FROM th_creations WHERE cre_id = ANY($1) AND cre_kind = 'pack' AND cre_status = 'published'`, [ids]);
    return packs.some((r) => (r['cre_content'].puzzles as Puzzle[]).some((p) => samePuzzle(p, puzzle)));
  }

  /** Affiche l'indice de l'énigme d'arrivée (gratuit). */
  async puzzleHint(viewer: Viewer, huntId: number): Promise<PlayState> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const state = await this.playState(db, me, huntId);
      if (!state.puzzle) throw conflict('Aucune énigme en cours.');
      await db.query('UPDATE th_arrivals SET arr_hint = true WHERE arr_team_tea = $1 AND arr_code_cod = $2', [state.team.id, state.puzzle.stepId]);
      return this.playState(db, me, huntId);
    });
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
   * dont elle vient ; republier sa chasse inchangée met seulement à jour sa fiche.
   */
  async publishToCatalog(viewer: Viewer, huntId: number, pub: CatalogPublication): Promise<CatalogDetail> {
    const me = requireUser(viewer);
    const id = await tx(this.pool, async (db) => {
      const hunt = await this.ownedHunt(db, me, huntId, true);
      if (hunt.status === 'cancelled') throw conflict('Une chasse annulée ne se partage pas au catalogue.');
      const steps = await stepsOf(db, huntId);
      const final = finalOrder(steps);
      if (final < 2) throw badRequest('Il faut au moins une étape entre le départ et l’arrivée pour partager la chasse au catalogue.');
      const missing = steps.find((s) => s.order < final && !s.instructions?.trim());
      if (missing) throw badRequest(`L’énigme ${missing.order === 0 ? 'de départ' : `de l’étape ${missing.order}`} n’est pas rédigée.`);
      const sample = steps.find((s) => s.order === pub.sampleOrder && s.order < final);
      if (!sample) throw badRequest('Choisissez comme extrait une énigme du parcours.');

      const content = catalogContent(hunt, steps);
      const fingerprint = contentFingerprint(content);
      // Version précédente : la dernière publication de cette chasse, sinon la version copiée.
      const previous = await one(db, 'SELECT cat_id, cat_fingerprint, cat_withdrawn FROM th_catalog WHERE cat_hunt_hun = $1 ORDER BY cat_id DESC LIMIT 1', [
        huntId,
      ]);
      const settings = [pub.travel, pub.difficulty, pub.durationMinutes];
      // Même parcours que sa dernière publication : l'auteur en corrige la fiche (présentation,
      // déplacement, difficulté, durée, extrait) au lieu d'en publier une nouvelle version.
      if (previous && !previous['cat_withdrawn'] && previous['cat_fingerprint'] === fingerprint) {
        await db.query(
          `UPDATE th_catalog SET cat_summary = $2, cat_travel = $3, cat_difficulty = $4, cat_duration = $5, cat_sample_order = $6, cat_sample = $7,
                                 cat_price = $8, cat_practical = $9, cat_minage = $10, cat_lastupdate = now() WHERE cat_id = $1`,
          [previous['cat_id'], pub.summary.trim() || hunt.description, ...settings, sample.order, sample.instructions, pub.price ?? 0, pub.practical ?? [], pub.minAge ?? null],
        );
        await db.query('UPDATE th_hunts SET hun_travel = $2, hun_difficulty = $3, hun_duration = $4, hun_lastupdate = now() WHERE hun_id = $1', [huntId, ...settings]);
        return previous['cat_id'] as number;
      }
      const parentId: number | null = previous?.['cat_id'] ?? hunt.catalogId;
      if (parentId) {
        const parent = (await one(db, 'SELECT cat_title, cat_fingerprint FROM th_catalog WHERE cat_id = $1', [parentId]))!;
        if (parent['cat_fingerprint'] === fingerprint) {
          throw conflict(
            `Le parcours n’a pas changé depuis « ${parent['cat_title']} » : modifiez des étapes, des énigmes, des jokers ou des pénalités avant de partager une nouvelle version.`,
          );
        }
      }
      const r = await one(
        db,
        `INSERT INTO th_catalog (cat_author_htr, cat_hunt_hun, cat_parent_cat, cat_title, cat_summary, cat_location, cat_difficulty,
                                 cat_duration, cat_stepcount, cat_validation, cat_sample_order, cat_sample, cat_changes, cat_content, cat_fingerprint,
                                 cat_travel, cat_price, cat_lat, cat_lng, cat_practical, cat_minage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING cat_id`,
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
          pub.travel,
          pub.price ?? 0,
          contentStart(content)?.lat ?? null,
          contentStart(content)?.lng ?? null,
          pub.practical ?? [],
          pub.minAge ?? null,
        ],
      );
      // La chasse garde ces réglages : la prochaine publication les reprend.
      await db.query('UPDATE th_hunts SET hun_travel = $2, hun_difficulty = $3, hun_duration = $4, hun_lastupdate = now() WHERE hun_id = $1', [huntId, ...settings]);
      return r!['cat_id'] as number;
    });
    return this.catalogEntry(me, id);
  }

  /** Catalogue public : versions non retirées, les mieux notées d'abord (ou les plus récentes, les plus jouées). */
  listCatalog(viewer: Viewer, opts: CatalogQuery): Promise<CatalogEntry[]> {
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
    if (opts.travel?.length) {
      params.push(opts.travel);
      where.push(`c.cat_travel = ANY($${params.length})`);
    }
    if (opts.difficulty?.length) {
      params.push(opts.difficulty);
      where.push(`c.cat_difficulty = ANY($${params.length})`);
    }
    if (opts.minDuration) {
      params.push(opts.minDuration);
      where.push(`c.cat_duration >= $${params.length}`);
    }
    if (opts.maxDuration) {
      params.push(opts.maxDuration);
      where.push(`c.cat_duration <= $${params.length}`);
    }
    // Jouables en autonomie : validées par géolocalisation, sans QR à poser (§ 13.5).
    if (opts.autonomous) where.push(`c.cat_validation = 'geo'`);
    // Repères pratiques (§ 26) : tous ceux demandés.
    if (opts.practical?.length) {
      params.push(opts.practical);
      where.push(`c.cat_practical @> $${params.length}::varchar[]`);
    }
    // Près de moi (§ 23) : distance à vol d'oiseau jusqu'au départ, en km (haversine).
    let distance: string | undefined;
    if (opts.near) {
      params.push(opts.near.lat, opts.near.lng);
      const la = `$${params.length - 1}::float8`;
      const lo = `$${params.length}::float8`;
      distance = `(12742 * asin(sqrt(least(1, power(sin(radians(c.cat_lat - ${la}) / 2), 2)
                   + cos(radians(${la})) * cos(radians(c.cat_lat)) * power(sin(radians(c.cat_lng - ${lo}) / 2), 2)))))`;
      if (opts.radius) {
        params.push(opts.radius);
        where.push(`c.cat_lat IS NOT NULL AND ${distance} <= $${params.length}`);
      }
    }
    const sort = opts.sort === 'distance' && !distance ? 'rating' : (opts.sort ?? 'rating');
    const order = {
      rating: 'ra.stars DESC NULLS LAST, coalesce(ra.n, 0) DESC, c.cat_id DESC',
      recent: 'c.cat_id DESC',
      plays: 'coalesce(pl.plays, 0) DESC, c.cat_id DESC',
      distance: `${distance} ASC NULLS LAST, c.cat_id DESC`,
    }[sort];
    return catalogEntries(this.pool, where.join(' AND '), params, order, distance);
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
    const owned = viewer !== null && !!(await one(this.pool, 'SELECT 1 FROM th_purchases WHERE pur_hunter_htr = $1 AND pur_product = $2', [viewer, catalogProductId(id)]));
    // Parties en autonomie du lecteur sur cette version : à lancer, en cours, terminées.
    const plays = viewer === null ? [] : await rows(
      this.pool,
      `SELECT h.hun_id, h.hun_end, t.tea_started, t.tea_finished FROM th_hunts h JOIN th_teams t ON t.tea_hunt_hun = h.hun_id
       JOIN th_teamhunters m ON m.thr_team_tea = t.tea_id
       WHERE h.hun_catalog_cat = $1 AND h.hun_surprise AND h.hun_host_htr IS NOT NULL AND m.thr_hunter_htr = $2 ORDER BY h.hun_id DESC`,
      [id, viewer],
    );
    const notices = await rows(
      this.pool,
      `${ENTRY_HUNTS} SELECT c.cod_order, r.rep_category, r.rep_creation FROM th_reports r JOIN eh ON eh.hun_id = r.rep_hunt_hun
       JOIN th_codes c ON c.cod_id = r.rep_code_cod WHERE eh.cat_id = $1 AND r.rep_status = 'open' ORDER BY r.rep_id DESC LIMIT 10`,
      [id],
    );
    return {
      ...entry,
      owned,
      openReports: notices.map((n) => ({ stepOrder: n['cod_order'], category: n['rep_category'], at: (n['rep_creation'] as Date).toISOString() })),
      myPlays: plays.map((p) => ({
        huntId: p['hun_id'],
        started: p['tea_started'] ? (p['tea_started'] as Date).toISOString() : null,
        finished: p['tea_finished'] ? (p['tea_finished'] as Date).toISOString() : null,
        until: (p['hun_end'] as Date).toISOString(),
      })),
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
    return tx(this.pool, async (db) => (await huntById(db, await this.instantiate(db, me, id, false)))!);
  }

  /**
   * Jouer en autonomie (§ 13.5) : une copie privée de la chasse, organisée par le compte
   * système, dont le joueur est l'hôte ; son équipe y est inscrite et donne elle-même le
   * départ, sur place, quand elle veut dans l'année. Le parcours reste caché. Une partie
   * achetée mais pas encore lancée est reprise plutôt que dupliquée.
   */
  async playFromCatalog(viewer: Viewer, id: number): Promise<Hunt> {
    const me = requireUser(viewer);
    return tx(this.pool, async (db) => {
      const waiting = await one(
        db,
        `SELECT h.hun_id FROM th_hunts h JOIN th_teams t ON t.tea_hunt_hun = h.hun_id
         WHERE h.hun_catalog_cat = $1 AND h.hun_surprise AND h.hun_host_htr = $2 AND t.tea_owner_htr = $2
           AND t.tea_started IS NULL AND h.hun_status_hst = $3 AND h.hun_end > now()
         ORDER BY h.hun_id DESC LIMIT 1`,
        [id, me, STATUS_IDS.published],
      );
      if (waiting) return (await huntById(db, waiting['hun_id']))!;
      const huntId = await this.instantiate(db, me, id, true);
      const nickname = (await hunterById(db, me))!.nickname;
      await this.addTeam(db, (await huntById(db, huntId))!, nickname, me, false);
      return (await huntById(db, huntId))!;
    });
  }

  /* ================================================================ Signalements et statistiques (§ 22) */

  /**
   * Un joueur signale un problème sur une étape qu'il a atteinte ou qu'il cherche : lieu
   * fermé, travaux, QR absent, énigme fausse… L'organisateur (ou l'auteur de la version du
   * catalogue) le voit et le traite. Dix signalements par jour et par chasse au plus.
   */
  async reportStep(viewer: Viewer, huntId: number, data: { stepOrder: number; category: ReportCategory; message: string | null }): Promise<StepReport> {
    const me = requireUser(viewer);
    const state = await this.playState(this.pool, me, huntId);
    const reachable = state.clue ? state.clue.targetOrder : state.team.finished ? state.totalSteps : 0;
    if (data.stepOrder < 1 || data.stepOrder > reachable) throw badRequest('Signalez une étape que vous avez atteinte ou que vous cherchez.');
    const step = (await stepsOf(this.pool, huntId)).find((s) => s.order === data.stepOrder)!;
    const recent = await one(this.pool, `SELECT count(*)::int AS n FROM th_reports WHERE rep_hunter_htr = $1 AND rep_hunt_hun = $2 AND rep_creation > now() - interval '1 day'`, [me, huntId]);
    if (recent!['n'] >= 10) throw new HttpError(429, 'Merci ! Vous avez déjà beaucoup signalé aujourd’hui.');
    const r = await one(
      this.pool,
      'INSERT INTO th_reports (rep_hunt_hun, rep_code_cod, rep_hunter_htr, rep_category, rep_message) VALUES ($1, $2, $3, $4, $5) RETURNING rep_id',
      [huntId, step.id, me, data.category, data.message?.trim() || null],
    );
    return (await this.reportsWhere('r.rep_id = $1', [r!['rep_id']]))[0];
  }

  /** Signalements d'une chasse, pour son organisateur. */
  async huntReports(viewer: Viewer, huntId: number): Promise<StepReport[]> {
    await this.ownedHunt(this.pool, viewer, huntId);
    return this.reportsWhere('r.rep_hunt_hun = $1', [huntId]);
  }

  /** Signalements de toutes les parties d'une version du catalogue (copies et autonomie comprises), pour son auteur. */
  async catalogReports(viewer: Viewer, catalogId: number): Promise<StepReport[]> {
    await this.authoredEntry(viewer, catalogId);
    return this.reportsWhere(`r.rep_hunt_hun IN (${ENTRY_HUNTS} SELECT hun_id FROM eh WHERE cat_id = $1)`, [catalogId]);
  }

  /** Marquer un signalement traité (ou le rouvrir) : l'organisateur de la chasse, ou l'auteur de la version. */
  async resolveReport(viewer: Viewer, reportId: number, resolved: boolean): Promise<StepReport> {
    const me = requireUser(viewer);
    const r = await one(
      this.pool,
      `${ENTRY_HUNTS} SELECT h.hun_owner_htr, (SELECT bool_or(c.cat_author_htr = $2) FROM eh JOIN th_catalog c ON c.cat_id = eh.cat_id WHERE eh.hun_id = h.hun_id) AS author
       FROM th_reports r JOIN th_hunts h ON h.hun_id = r.rep_hunt_hun WHERE r.rep_id = $1`,
      [reportId, me],
    );
    if (!r || (r['hun_owner_htr'] !== me && !r['author'])) throw notFound('Signalement introuvable.');
    await this.pool.query(
      `UPDATE th_reports SET rep_status = $2, rep_resolved = CASE WHEN $3 THEN now() END, rep_resolver_htr = CASE WHEN $3 THEN $4::int END WHERE rep_id = $1`,
      [reportId, resolved ? 'resolved' : 'open', resolved, me],
    );
    return (await this.reportsWhere('r.rep_id = $1', [reportId]))[0];
  }

  private async reportsWhere(where: string, params: unknown[]): Promise<StepReport[]> {
    const list = await rows(
      this.pool,
      `SELECT r.*, c.cod_order, c.cod_title, u.htr_nickname FROM th_reports r JOIN th_codes c ON c.cod_id = r.rep_code_cod
       LEFT JOIN th_hunters u ON u.htr_id = r.rep_hunter_htr WHERE ${where} ORDER BY r.rep_status = 'open' DESC, r.rep_id DESC LIMIT 200`,
      params,
    );
    return list.map((x) => ({
      id: x['rep_id'],
      huntId: x['rep_hunt_hun'],
      stepOrder: x['cod_order'],
      stepTitle: x['cod_title'],
      category: x['rep_category'],
      message: x['rep_message'],
      nickname: x['htr_nickname'],
      status: x['rep_status'],
      at: (x['rep_creation'] as Date).toISOString(),
      resolvedAt: x['rep_resolved'] ? (x['rep_resolved'] as Date).toISOString() : null,
    }));
  }

  private async authoredEntry(viewer: Viewer, catalogId: number): Promise<Row> {
    const me = requireUser(viewer);
    const r = await one(this.pool, 'SELECT * FROM th_catalog WHERE cat_id = $1', [catalogId]);
    if (!r) throw notFound('Cette chasse n’est pas au catalogue.');
    if (r['cat_author_htr'] !== me) throw forbidden('Réservé à l’auteur de la chasse.');
    return r;
  }

  /** Statistiques par étape d'une chasse, pour son organisateur. */
  async huntStats(viewer: Viewer, huntId: number): Promise<HuntStats> {
    await this.ownedHunt(this.pool, viewer, huntId);
    const steps = await stepsOf(this.pool, huntId);
    return this.statsFor([huntId], new Map(steps.map((s) => [s.order, s.title])));
  }

  /** Statistiques par étape d'une version du catalogue : toutes ses parties, copies et autonomie comprises. */
  async catalogStats(viewer: Viewer, catalogId: number): Promise<HuntStats> {
    const entry = await this.authoredEntry(viewer, catalogId);
    const hunts = await rows(this.pool, `${ENTRY_HUNTS} SELECT hun_id FROM eh WHERE cat_id = $1`, [catalogId]);
    const content = entry['cat_content'] as CatalogContent;
    return this.statsFor(hunts.map((h) => h['hun_id'] as number), new Map(content.steps.map((s) => [s.order, s.title])));
  }

  /** Statistiques par étape (shared/step-stats.ts) d'un ensemble de parties. */
  private async statsFor(huntIds: number[], titles: Map<number, string>): Promise<HuntStats> {
    const plays: PlayData[] = [];
    for (const huntId of huntIds) {
      const hunt = await huntById(this.pool, huntId);
      if (!hunt) continue;
      plays.push({
        over: hunt.status === 'closed' || hunt.status === 'archived',
        orderOf: new Map((await stepsOf(this.pool, huntId)).map((s) => [s.id, s.order])),
        teams: await teamsWhere(this.pool, 't.tea_hunt_hun = $1', [huntId]),
        validations: await validationsOfHunt(this.pool, huntId),
        hints: await hintUsesOfHunt(this.pool, huntId),
      });
    }
    return stepStats(plays, titles);
  }

  /** Classement des parties en autonomie d'une version : les équipes arrivées, au temps pénalités comprises. */
  async autonomyLeaderboard(viewer: Viewer, id: number): Promise<AutonomyLeaderboard> {
    const hunts = await huntsWhere(this.pool, 'h.hun_catalog_cat = $1 AND h.hun_surprise AND h.hun_host_htr IS NOT NULL', [id]);
    const rows: (AutonomyRow & { at: number })[] = [];
    let players = 0;
    for (const hunt of hunts.slice(-500)) {
      const teams = await teamsWhere(this.pool, 't.tea_hunt_hun = $1', [hunt.id]);
      players += teams.filter((t) => t.started).length;
      const ranking = computeRanking(hunt, teams, await validationsOfHunt(this.pool, hunt.id), await hintUsesOfHunt(this.pool, hunt.id));
      for (const r of ranking) {
        if (r.time === null || !r.finished) continue;
        const team = teams.find((t) => t.id === r.teamId)!;
        rows.push({
          rank: 0,
          teamName: r.teamName,
          members: r.members.length,
          time: r.time,
          penalty: r.penalty,
          hints: r.hints,
          skips: r.skips,
          finished: r.finished,
          mine: viewer !== null && team.members.some((m) => m.hunterId === viewer),
          at: Date.parse(r.finished),
        });
      }
    }
    rows.sort((a, b) => a.time - b.time || a.at - b.at);
    rows.forEach((r, i) => (r.rank = i + 1));
    return { finishers: rows.length, players, rows: rows.map(({ at, ...r }) => r) };
  }

  /**
   * Défi « bats mon temps » (§ 28) : le temps d'une partie en autonomie terminée de cette
   * version, et son rang. Rien de plus que ce que montre déjà le classement public.
   */
  async challenge(viewer: Viewer, id: number, huntId: number): Promise<Challenge> {
    const hunt = await huntById(this.pool, huntId);
    if (!hunt || hunt.catalogId !== id || !hunt.surprise || hunt.hostId === null) throw notFound('Ce défi n’existe pas.');
    const teams = await teamsWhere(this.pool, 't.tea_hunt_hun = $1', [huntId]);
    const row = computeRanking(hunt, teams, await validationsOfHunt(this.pool, huntId), await hintUsesOfHunt(this.pool, huntId)).find(
      (r) => r.time !== null && r.finished,
    );
    if (!row) throw notFound('Cette partie n’est pas encore terminée : pas de temps à battre.');
    const board = await this.autonomyLeaderboard(viewer, id);
    const rank = 1 + board.rows.filter((r) => r.time < row.time! || (r.time === row.time && Date.parse(r.finished) < Date.parse(row.finished!))).length;
    return { catalogId: id, huntId, teamName: row.teamName, time: row.time!, rank, finishers: board.finishers, finished: row.finished! };
  }

  /**
   * Crée une chasse à partir d'une version du catalogue. Pour l'organiser : un brouillon du
   * joueur, dans une semaine. Pour la jouer en autonomie : une chasse surprise ouverte un an.
   */
  private async instantiate(db: Db, me: number, id: number, play: boolean): Promise<number> {
    const r = await one(db, 'SELECT cat_content, cat_withdrawn, cat_travel, cat_difficulty, cat_duration, cat_price, cat_author_htr, cat_validation FROM th_catalog WHERE cat_id = $1', [id]);
    if (!r || r['cat_withdrawn']) throw notFound('Cette chasse n’est pas au catalogue.');
    if (play && r['cat_validation'] !== 'geo') throw conflict('Cette chasse se joue avec des QR codes posés par un organisateur : elle ne se joue pas en autonomie.');
    // Chasse payante (§ 20) : achetée une fois, copiée ou jouée autant qu'on veut ; gratuite sans paiement activé.
    if (this.payments?.enabled && r['cat_price'] > 0 && r['cat_author_htr'] !== me) {
      const bought = await one(db, 'SELECT 1 FROM th_purchases WHERE pur_hunter_htr = $1 AND pur_product = $2', [me, catalogProductId(id)]);
      if (!bought) throw new HttpError(402, `Cette chasse est payante : achetez-la pour la ${play ? 'jouer' : 'copier'}.`);
    }
    const content = r['cat_content'] as CatalogContent;
    const begin = play ? new Date() : new Date(Date.now() + 7 * 86_400_000);
    const data: Partial<Hunt> = {
      ...content.hunt,
      begin: begin.toISOString(),
      end: new Date(begin.getTime() + (play ? AUTONOMY_DAYS * 86_400_000 : 3 * 3_600_000)).toISOString(),
      isPublic: false,
      travel: r['cat_travel'],
      difficulty: r['cat_difficulty'],
      durationMinutes: r['cat_duration'],
      ...(play ? { teamGame: true, teamMin: 1, teamMax: SURPRISE_TEAM_MAX, autoStart: false, autoClose: true, startMode: 'mass' as const, interval: null } : {}),
    };
    const assignments = huntAssignments(data);
    const owner = play ? await this.systemAccount(db) : me;
    const cols = ['hun_owner_htr', 'hun_joincode', 'hun_catalog_cat', ...assignments.map(([c]) => c)];
    const values = [owner, joinCode(), id, ...assignments.map(([, v]) => v)];
    if (play) {
      cols.push('hun_surprise', 'hun_host_htr', 'hun_selfpaced', 'hun_status_hst');
      values.push(true, me, true, STATUS_IDS.published);
    }
    const h = await one(db, `INSERT INTO th_hunts (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING hun_id`, values);
    const huntId = h!['hun_id'] as number;
    for (const s of content.steps) {
      await db.query(
        `INSERT INTO th_codes (cod_hunt_hun, cod_order, cod_longid, cod_title, cod_arrival, cod_instructions, cod_hint1, cod_hint2, cod_hint3,
                               cod_latitude, cod_longitude, cod_address, cod_entrances, cod_puzzle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
          s.entrances?.length ? JSON.stringify(s.entrances) : null,
          s.puzzle ? JSON.stringify(s.puzzle) : null,
        ],
      );
    }
    return huntId;
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
      if (req.skin) await this.checkExtensions(db, me, { skin: req.skin }, null);
      // Épreuves proposées par l'IA : seulement les types des packs du joueur.
      if (req.puzzles?.length) {
        const owned = await this.ownedProducts(db, me);
        const missing = req.puzzles.map((t) => puzzleType(t)).find((t) => !owns(owned, t.pack));
        if (missing) throw forbidden(`« ${missing.name} » vient du pack « ${productById(missing.pack)!.name} » : obtenez-le d’abord dans la boutique.`);
      }
      // Qui règle la chasse (§ 21) : gratuite sans paiement, sinon fondateur, forfait ou crédit.
      // Seules les générations réussies ou en cours comptent : un échec ne coûte rien au joueur.
      const access = await generationAccess(db, me, !!this.payments?.enabled);
      if (!access.right) {
        throw new HttpError(access.blocked ? 429 : 402, access.blocked ?? 'La chasse sur mesure est payante : choisissez une chasse à l’unité ou un forfait.');
      }
      // Les essais, échecs compris, restent plafonnés pour ménager OpenStreetMap et l'API.
      const recent = await one(db, `SELECT count(*)::int AS attempts FROM th_generations WHERE gen_hunter_htr = $1 AND gen_creation > now() - interval '1 day'`, [me]);
      if (recent!['attempts'] >= config.generationDailyQuota * GENERATION_LIMITS.attemptsFactor) {
        throw new HttpError(429, 'Trop d’essais aujourd’hui : le générateur semble en difficulté, réessayez demain.');
      }
      return one(db, `INSERT INTO th_generations (gen_hunter_htr, gen_params, gen_right) VALUES ($1, $2, $3) RETURNING *`, [me, JSON.stringify(req), access.right]);
    });
    const run = this.runGeneration(job!['gen_id'], me, req).finally(() => this.inflight.delete(run));
    this.inflight.add(run);
    return toJob(job!);
  }

  /** Accès du joueur à la chasse sur mesure : formules, crédits, limites (§ 21). */
  async generationAccess(viewer: Viewer): Promise<GenerationAccess> {
    return generationAccess(this.pool, requireUser(viewer), !!this.payments?.enabled);
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
    const owned = await this.ownedProducts(db, me);
    const r = await one(
      db,
      `INSERT INTO th_hunts (hun_owner_htr, hun_joincode, hun_name, hun_description, hun_location, hun_begin, hun_end,
                             hun_autostart, hun_autoclose, hun_award, hun_starttext, hun_startmode, hun_penalty1, hun_penalty2,
                             hun_penalty3, hun_skippenalty, hun_teamgame, hun_teammin, hun_teammax, hun_public, hun_status_hst,
                             hun_validation, hun_georadius, hun_generated, hun_surprise, hun_host_htr, hun_travel, hun_difficulty, hun_duration,
                             hun_skin, hun_tools)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, true, $8, $9, 1, 2, 5, 10, 15, true, 1, $10, false, $11, 'geo', 40, true, $12, $13, $14, $15, $16,
               $17, $18)
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
        req.travel,
        req.difficulty,
        req.durationMinutes,
        req.skin ?? DEFAULT_SKIN,
        // Les outils que le joueur possède, en plus de la position en direct.
        [...new Set([...DEFAULT_TOOLS, ...TOOL_IDS.filter((t) => owned.has(`tool:${t}`))])],
      ],
    );
    const huntId = r!['hun_id'] as number;
    for (const [order, s] of plan.steps.entries()) {
      await db.query(
        `INSERT INTO th_codes (cod_hunt_hun, cod_order, cod_longid, cod_title, cod_arrival, cod_instructions, cod_hint1, cod_hint2, cod_hint3,
                               cod_latitude, cod_longitude, cod_address, cod_entrances, cod_puzzle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
          s.entrances?.length ? JSON.stringify(s.entrances) : null,
          order > 0 && s.puzzle ? JSON.stringify(s.puzzle) : null,
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
/** Une partie en autonomie se lance quand on veut, dans l'année qui suit son obtention. */
const AUTONOMY_DAYS = 365;

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

function startOf(steps: Step[]): PlayState['start'] {
  const s = steps.find((x) => x.order === 0);
  if (!s || s.latitude === null || s.longitude === null) return null;
  return { name: s.address?.trim() || null, lat: Number(s.latitude), lng: Number(s.longitude) };
}

/** Recherche dans le catalogue (§ 13). */
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
}

/**
 * Instantané publié : de quoi recréer la chasse (sans dates, équipes ni QR). Déplacement,
 * difficulté et durée sont des colonnes de l'entrée : ils n'entrent pas dans l'empreinte.
 */
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
  > &
    Partial<Pick<Hunt, 'skin' | 'tools'>>;
  steps: (Pick<Step, 'order' | 'title' | 'arrival' | 'instructions' | 'hints' | 'latitude' | 'longitude' | 'address'> & Partial<Pick<Step, 'entrances' | 'puzzle'>>)[];
}

/** Premier lieu placé du parcours (le départ, sinon la première étape) : repère de la carte du catalogue (§ 23). */
function contentStart(content: CatalogContent): { lat: number; lng: number } | null {
  const placed = content.steps.filter((s) => s.latitude !== null && s.longitude !== null).sort((a, b) => a.order - b.order);
  return placed.length ? { lat: placed[0]!.latitude!, lng: placed[0]!.longitude! } : null;
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
      skin: h.skin,
      tools: h.tools,
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
      // Seulement s'il y en a : l'empreinte des publications antérieures reste la même.
      ...(s.entrances.length ? { entrances: s.entrances } : {}),
      ...(s.puzzle ? { puzzle: s.puzzle } : {}),
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

async function catalogEntries(db: Db, where: string, params: unknown[], order = 'c.cat_id DESC', distance = 'NULL::float8'): Promise<CatalogEntry[]> {
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
            coalesce(c.cat_content -> 'hunt' ->> 'skin', '${DEFAULT_SKIN}') AS skin, c.cat_travel, c.cat_duration, c.cat_stepcount, c.cat_validation, c.cat_changes, c.cat_creation, c.cat_withdrawn, c.cat_price,
            c.cat_lat, c.cat_lng, ${distance} AS distance, c.cat_practical, c.cat_minage,
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
    skin: r['skin'],
    authorId: r['cat_author_htr'],
    authorNickname: r['author_nickname'],
    title: r['cat_title'],
    summary: r['cat_summary'],
    location: r['cat_location'],
    travel: r['cat_travel'],
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
    price: r['cat_price'] ?? 0,
    start: r['cat_lat'] === null ? null : { lat: r['cat_lat'], lng: r['cat_lng'] },
    distanceKm: r['distance'] === null ? null : Math.round(Number(r['distance']) * 10) / 10,
    practical: r['cat_practical'] ?? [],
    minAge: r['cat_minage'],
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

