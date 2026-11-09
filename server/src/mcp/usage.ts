/**
 * Mesure du serveur MCP (§ 50) : un appel d'outil (son nom, son nombre de résultats, rien de ce
 * qui a été demandé) et les fiches ouvertes depuis un lien d'assistant. Gardé 180 jours.
 */
import { McpStats } from '../../../shared/mcp.js';
import { Db, rows } from '../db.js';

export async function recordCall(db: Db, tool: string, results: number | null, error: boolean): Promise<void> {
  await db.query('INSERT INTO th_mcp_calls (mcc_tool, mcc_results, mcc_error) VALUES ($1, $2, $3)', [tool, results, error]);
  // Purge au fil de l'eau, une fois sur cent environ.
  if (Math.random() < 0.01) {
    await db.query(`DELETE FROM th_mcp_calls WHERE mcc_creation < now() - interval '180 days'`);
    await db.query(`DELETE FROM th_mcp_visits WHERE mcv_creation < now() - interval '180 days'`);
  }
}

export async function recordVisit(db: Db, catalogId: number): Promise<boolean> {
  const r = await db.query(
    'INSERT INTO th_mcp_visits (mcv_catalog_cat) SELECT cat_id FROM th_catalog WHERE cat_id = $1 AND cat_withdrawn IS NULL',
    [catalogId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function mcpStats(db: Db): Promise<McpStats> {
  const tools = await rows(
    db,
    `SELECT mcc_tool,
            count(*) FILTER (WHERE mcc_creation > now() - interval '7 days')::int AS calls7,
            count(*)::int AS calls30,
            count(*) FILTER (WHERE mcc_results = 0)::int AS empty30,
            count(*) FILTER (WHERE mcc_error)::int AS errors30
     FROM th_mcp_calls WHERE mcc_creation > now() - interval '30 days' GROUP BY mcc_tool ORDER BY calls30 DESC, mcc_tool`,
  );
  const visits = (
    await rows(
      db,
      `SELECT count(*) FILTER (WHERE mcv_creation > now() - interval '7 days')::int AS v7, count(*)::int AS v30
       FROM th_mcp_visits WHERE mcv_creation > now() - interval '30 days'`,
    )
  )[0]!;
  const top = await rows(
    db,
    `SELECT v.mcv_catalog_cat, c.cat_title, count(*)::int AS n FROM th_mcp_visits v JOIN th_catalog c ON c.cat_id = v.mcv_catalog_cat
     WHERE v.mcv_creation > now() - interval '30 days' GROUP BY v.mcv_catalog_cat, c.cat_title ORDER BY n DESC, v.mcv_catalog_cat LIMIT 5`,
  );
  const daily = await rows(
    db,
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            (SELECT count(*)::int FROM th_mcp_calls WHERE mcc_creation >= d AND mcc_creation < d + interval '1 day') AS calls,
            (SELECT count(*)::int FROM th_mcp_visits WHERE mcv_creation >= d AND mcv_creation < d + interval '1 day') AS visits
     FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`,
  );
  return {
    tools: tools.map((t) => ({ tool: t['mcc_tool'], calls7: t['calls7'], calls30: t['calls30'], empty30: t['empty30'], errors30: t['errors30'] })),
    visits7: visits['v7'],
    visits30: visits['v30'],
    topVisited: top.map((t) => ({ catalogId: t['mcv_catalog_cat'], title: t['cat_title'], visits: t['n'] })),
    daily: daily.map((d) => ({ day: d['day'], calls: d['calls'], visits: d['visits'] })),
  };
}
