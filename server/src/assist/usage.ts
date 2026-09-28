/**
 * Décompte de l'assistant de rédaction (§ 25) : les suggestions des 30 derniers jours, et
 * le forfait qui fixe la limite (fondateur, forfait de génération en cours, sinon de base).
 */
import { AssistAction, AssistPlan, AssistUsage, assistUsage } from '../../../shared/assist.js';
import { Db, one, rows } from '../db.js';

export async function assistUsageOf(db: Db, me: number): Promise<AssistUsage> {
  const u = (await one(
    db,
    `SELECT h.htr_founder,
            EXISTS (SELECT 1 FROM th_genrights WHERE grt_hunter_htr = h.htr_id AND grt_kind = 'pass' AND grt_until > now()) AS pass
     FROM th_hunters h WHERE h.htr_id = $1`,
    [me],
  ))!;
  const plan: AssistPlan = u['htr_founder'] ? 'founder' : u['pass'] ? 'pass' : 'base';
  const uses = await rows(db, `SELECT ass_action, ass_creation FROM th_assists WHERE ass_hunter_htr = $1 AND ass_creation > now() - interval '30 days'`, [me]);
  return assistUsage(
    uses.map((r) => ({ action: r['ass_action'] as AssistAction, at: (r['ass_creation'] as Date).toISOString() })),
    plan,
  );
}
