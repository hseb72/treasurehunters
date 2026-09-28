/**
 * Accès à la génération (§ 21) : ce qu'un joueur a (fondateur, forfait, crédits achetés ou
 * gagnés), ce qu'il a consommé, et ce qui réglera sa prochaine chasse.
 */
import { creatorBonus, GENERATION_LIMITS, GenerationAccess, GenerationOffer, pickRight } from '../../../shared/generation-access.js';
import { config } from '../config.js';
import { Db, one } from '../db.js';
import { STATUS_IDS } from '../repo.js';

export async function generationAccess(db: Db, me: number, paid: boolean): Promise<GenerationAccess> {
  const u = (await one(
    db,
    `SELECT h.htr_founder,
            (SELECT max(grt_until) FROM th_genrights WHERE grt_hunter_htr = h.htr_id AND grt_kind = 'pass') AS pass_until,
            (SELECT coalesce(sum(grt_credits), 0)::int FROM th_genrights WHERE grt_hunter_htr = h.htr_id AND grt_kind = 'credits') AS purchased,
            (SELECT count(*)::int FROM th_generations WHERE gen_hunter_htr = h.htr_id AND gen_status <> 'error' AND gen_right = 'credit') AS used,
            (SELECT count(*)::int FROM th_generations WHERE gen_hunter_htr = h.htr_id AND gen_status <> 'error' AND gen_creation > now() - interval '1 day') AS today,
            (SELECT count(*)::int FROM th_generations WHERE gen_hunter_htr = h.htr_id AND gen_status <> 'error' AND gen_right = 'pass'
                                                          AND gen_creation > now() - interval '30 days') AS pass_period,
            -- Chasses partagées par le joueur et jouées jusqu'au bout par d'autres (copie organisée ou partie en autonomie).
            (SELECT count(DISTINCT c.cat_id)::int FROM th_catalog c JOIN th_hunts x ON x.hun_catalog_cat = c.cat_id
              WHERE c.cat_author_htr = h.htr_id AND x.hun_status_hst IN ($2, $3)
                AND x.hun_owner_htr <> h.htr_id AND x.hun_host_htr IS DISTINCT FROM h.htr_id) AS shared_played
     FROM th_hunters h WHERE h.htr_id = $1`,
    [me, STATUS_IDS.closed, STATUS_IDS.archived],
  ))!;
  const bonus = creatorBonus(u['shared_played']);
  const base: Omit<GenerationAccess, 'right' | 'blocked'> = {
    paid,
    founder: !!u['htr_founder'],
    passUntil: u['pass_until'] ? (u['pass_until'] as Date).toISOString() : null,
    credits: { purchased: u['purchased'], bonus, used: u['used'], available: Math.max(0, u['purchased'] + bonus - u['used']) },
    sharedPlayed: u['shared_played'],
    usage: { today: u['today'], daily: config.generationDailyQuota, passPeriod: u['pass_period'], passMonthly: GENERATION_LIMITS.passMonthly },
  };
  return { ...base, ...pickRight(base) };
}

/** Droit acheté : crédits ajoutés, ou forfait qui prolonge le forfait en cours. */
export async function grantOffer(db: Db, me: number, offer: GenerationOffer, paymentId: number | null): Promise<void> {
  if (offer.credits) {
    await db.query(`INSERT INTO th_genrights (grt_hunter_htr, grt_kind, grt_credits, grt_payment_pay) VALUES ($1, 'credits', $2, $3)`, [me, offer.credits, paymentId]);
    return;
  }
  await db.query(
    `INSERT INTO th_genrights (grt_hunter_htr, grt_kind, grt_from, grt_until, grt_payment_pay)
     SELECT $1, 'pass', f.start, f.start + make_interval(days => $2), $3
     FROM (SELECT greatest(now(), coalesce((SELECT max(grt_until) FROM th_genrights WHERE grt_hunter_htr = $1 AND grt_kind = 'pass'), now())) AS start) f`,
    [me, offer.days, paymentId],
  );
}
