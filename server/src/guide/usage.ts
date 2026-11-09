/**
 * Décompte du guide (§ 46) : demandes des 30 derniers jours d'un joueur connecté (son forfait
 * fixe la limite), ou d'un visiteur sans compte, reconnu par une empreinte HMAC de son adresse IP.
 */
import { createHmac } from 'node:crypto';
import { GuidePlan, GuideUsage, guideUsage } from '../../../shared/guide.js';
import { Db, one, rows } from '../db.js';

/** Qui demande : un joueur, ou un visiteur (empreinte). */
export type GuideWho = { hunter: number } | { visitor: string };

let key: string | null = null;

/** Empreinte d'une adresse IP : impossible à inverser sans la clé de la base. */
export async function visitorOf(db: Db, ip: string): Promise<string> {
  key ??= (await one(db, 'SELECT gky_key FROM th_guide_key LIMIT 1'))!['gky_key'] as string;
  return createHmac('sha256', key).update(ip).digest('hex');
}

export async function guideUsageOf(db: Db, who: GuideWho): Promise<GuideUsage> {
  if ('visitor' in who) {
    const uses = await rows(db, `SELECT gui_creation FROM th_guide_uses WHERE gui_visitor = $1 AND gui_creation > now() - interval '30 days'`, [who.visitor]);
    const today = await one(db, `SELECT count(*)::int AS n FROM th_guide_uses WHERE gui_hunter_htr IS NULL AND gui_creation > now() - interval '1 day'`);
    return guideUsage(uses.map(iso), 'visitor', Date.now(), today!['n']);
  }
  const u = (await one(
    db,
    `SELECT h.htr_founder,
            EXISTS (SELECT 1 FROM th_genrights WHERE grt_hunter_htr = h.htr_id AND grt_kind = 'pass' AND grt_until > now()) AS pass
     FROM th_hunters h WHERE h.htr_id = $1`,
    [who.hunter],
  ))!;
  const plan: GuidePlan = u['htr_founder'] ? 'founder' : u['pass'] ? 'pass' : 'base';
  const uses = await rows(db, `SELECT gui_creation FROM th_guide_uses WHERE gui_hunter_htr = $1 AND gui_creation > now() - interval '30 days'`, [who.hunter]);
  return guideUsage(uses.map(iso), plan);
}

function iso(r: Record<string, unknown>): string {
  return (r['gui_creation'] as Date).toISOString();
}
