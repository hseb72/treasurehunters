/**
 * Règles du jeu, sous forme de fonctions pures (docs/conception.md § 4 et § 5).
 * Utilisées par l'API factice des maquettes ; le back-end devra appliquer exactement les mêmes.
 */
import { HintUse, Hunt, RankingRow, ScanOutcome, Step, Team, Validation } from './models.js';

const MINUTE = 60_000;

/** Heure de départ de chaque équipe au déclenchement de la chasse (§ 5.1). */
export function teamStartTimes(hunt: Pick<Hunt, 'startMode' | 'interval'>, teams: Team[], startedAt: string): Map<number, string> {
  const start = Date.parse(startedAt);
  const result = new Map<number, string>();
  if (hunt.startMode === 'mass') {
    teams.forEach((t) => result.set(t.id, new Date(start).toISOString()));
    return result;
  }
  const interval = (hunt.interval ?? 0) * MINUTE;
  // Les équipes sans ordre de passage partent après les autres, par ordre d'inscription.
  const ordered = [...teams].sort(
    (a, b) => (a.startOrder ?? Number.MAX_SAFE_INTEGER) - (b.startOrder ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
  );
  ordered.forEach((t, i) => result.set(t.id, new Date(start + i * interval).toISOString()));
  return result;
}

/** Dernière étape du parcours (l'arrivée). */
export function finalOrder(steps: Step[]): number {
  return steps.reduce((max, s) => Math.max(max, s.order), 0);
}

/** Ordre de la dernière étape validée par l'équipe (0 si aucune : l'équipe cherche l'étape 1). */
export function lastValidatedOrder(steps: Step[], validations: Validation[]): number {
  const orders = validations.map((v) => steps.find((s) => s.id === v.stepId)?.order ?? 0);
  return orders.reduce((max, o) => Math.max(max, o), 0);
}

export interface ScanContext {
  hunt: Hunt | null;
  steps: Step[];
  step: Step | null;
  viewerId: number | null;
  /** Équipe du joueur connecté dans cette chasse. */
  team: Team | null;
  /** Validations de cette équipe. */
  validations: Validation[];
  now: number;
}

/** Applique l'algorithme de validation d'un scan (§ 4.2). Le premier cas qui s'applique l'emporte. */
export function evaluateScan(ctx: ScanContext): ScanOutcome {
  const { hunt, step } = ctx;
  if (!hunt || !step || hunt.status === 'draft') return 'unknown';
  if (hunt.status === 'cancelled') return 'cancelled';
  if (hunt.status === 'published' || !hunt.started) return 'not_started';
  if (hunt.status === 'closed' || hunt.status === 'archived') return 'closed';
  if (ctx.viewerId === null) return 'login_required';
  if (hunt.ownerId === ctx.viewerId) return 'organizer';
  if (!ctx.team) return 'not_registered';
  if (!ctx.team.started || Date.parse(ctx.team.started) > ctx.now) return 'team_not_started';
  if (ctx.team.finished) return 'team_finished';
  if (ctx.validations.some((v) => v.stepId === step.id)) return 'already_validated';
  if (step.order !== lastValidatedOrder(ctx.steps, ctx.validations) + 1) return 'skipped';
  return 'validated';
}

/** Pénalité d'un ensemble de jokers dévoilés, en minutes (§ 5.2). */
export function hintPenaltyMinutes(hunt: Pick<Hunt, 'hintPenalties'>, uses: Pick<HintUse, 'level'>[]): number {
  return uses.reduce((sum, u) => sum + (hunt.hintPenalties[u.level - 1] ?? 0), 0);
}

/** Pénalités d'une équipe, en minutes : jokers selon leur niveau, plus chaque épreuve abandonnée (§ 5.2). */
export function penaltyMinutes(
  hunt: Pick<Hunt, 'hintPenalties' | 'skipPenalty'>,
  uses: Pick<HintUse, 'level'>[],
  validations: Pick<Validation, 'source'>[],
): number {
  const skips = validations.filter((v) => v.source === 'SKIP').length;
  return hintPenaltyMinutes(hunt, uses) + skips * hunt.skipPenalty;
}

/**
 * Classement (§ 5.2) : temps = arrivée − départ + pénalités (jokers et abandons).
 * En départ groupé, cela revient à classer par ordre d'arrivée.
 * Les équipes non arrivées suivent, par nombre d'étapes puis par temps écoulé à leur dernière validation.
 */
export function computeRanking(
  hunt: Pick<Hunt, 'hintPenalties' | 'skipPenalty'>,
  teams: Team[],
  validations: Validation[],
  hintUses: HintUse[],
): RankingRow[] {
  const rows: RankingRow[] = teams.map((t) => {
    const vals = validations.filter((v) => v.teamId === t.id);
    const uses = hintUses.filter((h) => h.teamId === t.id);
    const hints = uses.length;
    const skips = vals.filter((v) => v.source === 'SKIP').length;
    const penalty = penaltyMinutes(hunt, uses, vals) * 60;
    const time = t.finished && t.started ? (Date.parse(t.finished) - Date.parse(t.started)) / 1000 + penalty : null;
    const lastValidation = vals.map((v) => v.at).sort().at(-1) ?? null;
    return {
      rank: null,
      teamId: t.id,
      teamName: t.name,
      members: t.members.map((m) => m.nickname),
      started: t.started,
      finished: t.finished,
      steps: vals.length,
      hints,
      skips,
      time,
      penalty,
      lastValidation,
    };
  });

  rows.sort((a, b) => {
    if (a.time !== null && b.time !== null) {
      return a.time - b.time || a.finished!.localeCompare(b.finished!) || a.hints + a.skips - (b.hints + b.skips);
    }
    if (a.time !== null) return -1;
    if (b.time !== null) return 1;
    return b.steps - a.steps || elapsedAtLast(a) - elapsedAtLast(b);
  });

  let rank = 0;
  rows.forEach((r) => {
    if (r.time !== null) r.rank = ++rank;
  });
  return rows;
}

/** Temps écoulé entre le départ de l'équipe et sa dernière validation (ms). */
function elapsedAtLast(r: RankingRow): number {
  if (!r.lastValidation || !r.started) return Number.MAX_SAFE_INTEGER;
  return Date.parse(r.lastValidation) - Date.parse(r.started);
}

/** Position provisoire d'une équipe dans le classement. */
export function teamPosition(rows: RankingRow[], teamId: number): { rank: number; total: number } | null {
  const i = rows.findIndex((r) => r.teamId === teamId);
  return i < 0 ? null : { rank: i + 1, total: rows.length };
}

/** Durée en secondes → « 1 h 05 min 12 s ». */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h} h ${pad(m)} min ${pad(sec)} s` : `${m} min ${pad(sec)} s`;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Jeton aléatoire de QR code : 22 caractères base62 ≈ 128 bits (§ 4.1). */
export function randomToken(length = 22): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // 62 × 4 = 248 : on rejette les octets ≥ 248 pour éviter un biais.
  let out = '';
  while (out.length < length) {
    for (const b of bytes) {
      if (b < 248 && out.length < length) out += BASE62[b % 62];
    }
    crypto.getRandomValues(bytes);
  }
  return out;
}
