/**
 * Accès aux données : requêtes SQL et conversion des lignes en objets du modèle partagé.
 */
import { HintUse, Hunt, HuntStatus, Hunter, Step, Team, Validation } from '../../shared/models.js';
import { Db, one, Row, rows } from './db.js';

export const STATUS_IDS: Record<HuntStatus, number> = {
  draft: 1,
  published: 2,
  running: 3,
  closed: 4,
  cancelled: 5,
  archived: 6,
};

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/* ---------------------------------------------------------------- Joueurs */

export function toHunter(r: Row): Hunter {
  return { id: r['htr_id'], nickname: r['htr_nickname'], email: r['htr_email'] };
}

export async function hunterById(db: Db, id: number): Promise<Hunter | null> {
  const r = await one(db, 'SELECT * FROM th_hunters WHERE htr_id = $1', [id]);
  return r ? toHunter(r) : null;
}

/* ---------------------------------------------------------------- Chasses */

/** Chasse enrichie : statut, pseudo de l'organisateur, nombre d'étapes et d'équipes. */
const HUNT_SELECT = `
  SELECT h.*, s.hst_code, o.htr_nickname AS owner_nickname,
         (SELECT coalesce(max(c.cod_order), 0) FROM th_codes c WHERE c.cod_hunt_hun = h.hun_id) AS step_count,
         (SELECT count(*) FROM th_teams t WHERE t.tea_hunt_hun = h.hun_id)::int AS team_count
  FROM th_hunts h
  JOIN th_huntstatus s ON s.hst_id = h.hun_status_hst
  JOIN th_hunters o ON o.htr_id = h.hun_owner_htr`;

export function toHunt(r: Row): Hunt {
  return {
    id: r['hun_id'],
    ownerId: r['hun_owner_htr'],
    ownerNickname: r['owner_nickname'],
    name: r['hun_name'],
    description: r['hun_description'],
    location: r['hun_location'],
    begin: iso(r['hun_begin'])!,
    end: iso(r['hun_end'])!,
    started: iso(r['hun_started']),
    closed: iso(r['hun_closed']),
    autoStart: r['hun_autostart'],
    autoClose: r['hun_autoclose'],
    award: r['hun_award'],
    startMode: r['hun_startmode'] === 2 ? 'staggered' : 'mass',
    interval: r['hun_interval'],
    hintPenalties: [r['hun_penalty1'], r['hun_penalty2'], r['hun_penalty3']],
    skipPenalty: r['hun_skippenalty'],
    teamGame: r['hun_teamgame'],
    teamMin: r['hun_teammin'],
    teamMax: r['hun_teammax'],
    isPublic: r['hun_public'],
    joinCode: r['hun_joincode'],
    contribution: r['hun_contribution'],
    startText: r['hun_starttext'],
    validation: r['hun_validation'],
    geoRadius: r['hun_georadius'],
    generated: r['hun_generated'],
    surprise: r['hun_surprise'],
    status: r['hst_code'],
    stepCount: r['step_count'],
    teamCount: r['team_count'],
  };
}

export async function huntById(db: Db, id: number, lock = false): Promise<Hunt | null> {
  if (lock) await db.query('SELECT 1 FROM th_hunts WHERE hun_id = $1 FOR UPDATE', [id]);
  const r = await one(db, `${HUNT_SELECT} WHERE h.hun_id = $1`, [id]);
  return r ? toHunt(r) : null;
}

export async function huntsWhere(db: Db, where: string, params: unknown[]): Promise<Hunt[]> {
  return (await rows(db, `${HUNT_SELECT} WHERE ${where} ORDER BY h.hun_begin, h.hun_id`, params)).map(toHunt);
}

/** Colonnes modifiables d'une chasse, dans le vocabulaire de l'API. */
export const HUNT_COLUMNS: Partial<Record<keyof Hunt, (h: Partial<Hunt>) => [string, unknown][]>> = {
  name: (h) => [['hun_name', h.name]],
  description: (h) => [['hun_description', h.description]],
  location: (h) => [['hun_location', h.location]],
  begin: (h) => [['hun_begin', h.begin]],
  end: (h) => [['hun_end', h.end]],
  autoStart: (h) => [['hun_autostart', h.autoStart]],
  autoClose: (h) => [['hun_autoclose', h.autoClose]],
  award: (h) => [['hun_award', h.award]],
  startText: (h) => [['hun_starttext', h.startText]],
  startMode: (h) => [['hun_startmode', h.startMode === 'staggered' ? 2 : 1]],
  interval: (h) => [['hun_interval', h.interval]],
  hintPenalties: (h) => (h.hintPenalties ?? []).map((p, i) => [`hun_penalty${i + 1}`, p] as [string, unknown]),
  skipPenalty: (h) => [['hun_skippenalty', h.skipPenalty]],
  teamGame: (h) => [['hun_teamgame', h.teamGame]],
  teamMin: (h) => [['hun_teammin', h.teamMin]],
  teamMax: (h) => [['hun_teammax', h.teamMax]],
  isPublic: (h) => [['hun_public', h.isPublic]],
  contribution: (h) => [['hun_contribution', h.contribution]],
  validation: (h) => [['hun_validation', h.validation]],
  geoRadius: (h) => [['hun_georadius', h.geoRadius]],
};

export function huntAssignments(data: Partial<Hunt>): [string, unknown][] {
  return (Object.keys(data) as (keyof Hunt)[]).flatMap((k) => HUNT_COLUMNS[k]?.(data) ?? []);
}

/* ---------------------------------------------------------------- Étapes */

export function toStep(r: Row): Step {
  return {
    id: r['cod_id'],
    huntId: r['cod_hunt_hun'],
    order: r['cod_order'],
    token: r['cod_longid'],
    title: r['cod_title'],
    arrival: r['cod_arrival'],
    instructions: r['cod_instructions'],
    hints: [r['cod_hint1'], r['cod_hint2'], r['cod_hint3']].filter((h): h is string => !!h),
    answer: r['cod_answer'],
    latitude: r['cod_latitude'],
    longitude: r['cod_longitude'],
    address: r['cod_address'],
  };
}

export async function stepsOf(db: Db, huntId: number): Promise<Step[]> {
  return (await rows(db, 'SELECT * FROM th_codes WHERE cod_hunt_hun = $1 ORDER BY cod_order', [huntId])).map(toStep);
}

export async function stepById(db: Db, id: number): Promise<Step | null> {
  const r = await one(db, 'SELECT * FROM th_codes WHERE cod_id = $1', [id]);
  return r ? toStep(r) : null;
}

export async function stepByToken(db: Db, token: string): Promise<Step | null> {
  const r = await one(db, 'SELECT * FROM th_codes WHERE cod_longid = $1', [token]);
  return r ? toStep(r) : null;
}

/* ---------------------------------------------------------------- Équipes */

const TEAM_SELECT = `
  SELECT t.*,
         coalesce(json_agg(json_build_object('hunterId', m.thr_hunter_htr, 'nickname', u.htr_nickname) ORDER BY m.thr_id)
                  FILTER (WHERE m.thr_id IS NOT NULL), '[]') AS members
  FROM th_teams t
  LEFT JOIN th_teamhunters m ON m.thr_team_tea = t.tea_id
  LEFT JOIN th_hunters u ON u.htr_id = m.thr_hunter_htr`;

export function toTeam(r: Row): Team {
  return {
    id: r['tea_id'],
    huntId: r['tea_hunt_hun'],
    name: r['tea_name'],
    ownerId: r['tea_owner_htr'],
    joinCode: r['tea_joincode'],
    solo: r['tea_solo'],
    startOrder: r['tea_startorder'],
    started: iso(r['tea_started']),
    finished: iso(r['tea_finished']),
    members: r['members'],
  };
}

export async function teamsWhere(db: Db, where: string, params: unknown[]): Promise<Team[]> {
  const sql = `${TEAM_SELECT} WHERE ${where} GROUP BY t.tea_id ORDER BY t.tea_startorder NULLS LAST, t.tea_id`;
  return (await rows(db, sql, params)).map(toTeam);
}

export async function teamById(db: Db, id: number, lock = false): Promise<Team | null> {
  if (lock) await db.query('SELECT 1 FROM th_teams WHERE tea_id = $1 FOR UPDATE', [id]);
  return (await teamsWhere(db, 't.tea_id = $1', [id]))[0] ?? null;
}

/** Équipe d'un joueur dans une chasse. */
export async function teamOf(db: Db, huntId: number, hunterId: number | null): Promise<Team | null> {
  if (hunterId === null) return null;
  const r = await one(db, 'SELECT thr_team_tea FROM th_teamhunters WHERE thr_hunt_hun = $1 AND thr_hunter_htr = $2', [huntId, hunterId]);
  return r ? teamById(db, r['thr_team_tea']) : null;
}

/* ---------------------------------------------------------------- Progression */

export async function validationsOfHunt(db: Db, huntId: number): Promise<Validation[]> {
  const list = await rows(
    db,
    `SELECT v.* FROM th_validations v JOIN th_teams t ON t.tea_id = v.val_team_tea WHERE t.tea_hunt_hun = $1 ORDER BY v.val_id`,
    [huntId],
  );
  return list.map((r) => ({
    teamId: r['val_team_tea'],
    stepId: r['val_code_cod'],
    hunterId: r['val_hunter_htr'],
    source: r['val_source'],
    at: iso(r['val_creation'])!,
  }));
}

export async function hintUsesOfHunt(db: Db, huntId: number): Promise<HintUse[]> {
  const list = await rows(
    db,
    `SELECT h.* FROM th_hintuses h JOIN th_teams t ON t.tea_id = h.hiu_team_tea WHERE t.tea_hunt_hun = $1 ORDER BY h.hiu_id`,
    [huntId],
  );
  return list.map((r) => ({
    teamId: r['hiu_team_tea'],
    stepId: r['hiu_code_cod'],
    level: r['hiu_level'],
    hunterId: r['hiu_hunter_htr'],
    at: iso(r['hiu_creation'])!,
  }));
}
