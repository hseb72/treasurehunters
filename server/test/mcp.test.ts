import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, loginAs, publishedEntry, setup, teardown } from './helpers.js';

let ctx: Ctx;
let url: URL;
beforeAll(async () => {
  ctx = await setup();
  const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  url = new URL('/api/mcp', address);
});
afterAll(() => teardown(ctx));

async function connect(): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
}

/** Réponse d'un outil : la structure déclarée, identique au texte JSON. */
function parse(r: unknown) {
  const res = r as { content: { text: string }[]; structuredContent?: unknown };
  const fromText = JSON.parse(res.content[0]!.text);
  expect(res.structuredContent).toEqual(fromText);
  return fromText;
}

const MONTPELLIER = { lat: 43.6085, lng: 3.8795 };

async function playThrough(player: Awaited<ReturnType<typeof loginAs>>, huntId: number) {
  await player.post(`/api/hunts/${huntId}/self-start`);
  const steps = (await ctx.pool.query('SELECT cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order > 0 ORDER BY cod_order', [huntId])).rows;
  for (const s of steps) await player.post(`/api/hunts/${huntId}/checkin`, { lat: s.cod_latitude, lng: s.cod_longitude, accuracy: 5 });
}

describe('serveur MCP du catalogue (§ 50)', () => {
  it('se présente, liste ses outils en lecture seule avec la forme de leurs réponses', async () => {
    const client = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: 'secrettracks' });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_secret_track', 'leaderboard', 'search_secret_tracks', 'surprise_me', 'upcoming_sessions']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.every((t) => t.outputSchema?.type === 'object')).toBe(true);
    await client.close();
  });

  it('cherche, montre une fiche sans le parcours, surprend, classe', async () => {
    const { entry } = await publishedEntry(ctx, 'camille@example.com', { audience: ['family'] });
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    await playThrough(zoe, (await zoe.post(`/api/catalog/${entry.id}/play`)).body.id);
    const client = await connect();

    const found = parse(await client.callTool({ name: 'search_secret_tracks', arguments: { near: MONTPELLIER, audience: ['family'] } }));
    const hunt = found.hunts.find((h: { id: number }) => h.id === entry.id);
    expect(hunt).toMatchObject({ self_guided: true, audience: ['family'], url: expect.stringMatching(new RegExp(`/catalog/${entry.id}\\?via=mcp$`)), distance_km: expect.any(Number) });
    expect(parse(await client.callTool({ name: 'search_secret_tracks', arguments: { audience: ['couple'] } })).hunts.map((h: { id: number }) => h.id)).not.toContain(entry.id);

    const detail = parse(await client.callTool({ name: 'get_secret_track', arguments: { id: entry.id } }));
    expect(detail).toMatchObject({ id: entry.id, sample_riddle: expect.any(String), upcoming_sessions: [] });
    // Jamais le parcours : ni étapes, ni positions, ni réponses.
    const text = JSON.stringify(detail);
    for (const secret of ['latitude', 'longitude', 'instructions', 'hints', 'answer', 'content']) expect(text).not.toContain(`"${secret}"`);

    const board = parse(await client.callTool({ name: 'leaderboard', arguments: { id: entry.id } }));
    expect(board).toMatchObject({ finishers: 1, players: 1, rows: [expect.objectContaining({ rank: 1, players: 1, time_minutes: expect.any(Number) })] });

    expect((await client.callTool({ name: 'get_secret_track', arguments: { id: 999_999 } })).isError).toBe(true);
    expect((await client.callTool({ name: 'leaderboard', arguments: { id: 999_999 } })).isError).toBe(true);

    const surprise = parse(await client.callTool({ name: 'surprise_me', arguments: { near: MONTPELLIER, minutes: 120 } }));
    expect(surprise.reasons).toEqual(expect.any(Array));

    // Arguments invalides : une erreur d'outil, pas une panne.
    expect((await client.callTool({ name: 'search_secret_tracks', arguments: { travel: ['plane'] } })).isError).toBe(true);
    await client.close();
  });

  it('liste les sessions publiques à venir, près d’un lieu', async () => {
    const { entry } = await publishedEntry(ctx, 'camille@example.com');
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const copy = (await seb.post(`/api/catalog/${entry.id}/copy`)).body;
    const begin = new Date(Date.now() + 2 * 86_400_000);
    await seb.patch(`/api/hunts/${copy.id}`, { name: 'Rallye du samedi', isPublic: true, begin: begin.toISOString(), end: new Date(begin.getTime() + 3 * 3_600_000).toISOString(), startMode: 'staggered', interval: 10 });
    expect((await seb.post(`/api/hunts/${copy.id}/publish`)).body.status).toBe('published');
    const client = await connect();

    const near = parse(await client.callTool({ name: 'upcoming_sessions', arguments: { near: MONTPELLIER, days: 7 } }));
    expect(near.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Rallye du samedi', hunt_id: entry.id, organizer: 'seb', staggered_start_every_minutes: 10, url: expect.stringContaining(`/hunts/${copy.id}`), distance_km: expect.any(Number) }),
      ]),
    );
    expect(parse(await client.callTool({ name: 'upcoming_sessions', arguments: { near: MONTPELLIER, days: 1 } })).sessions.map((s: { name: string }) => s.name)).not.toContain('Rallye du samedi');
    expect(parse(await client.callTool({ name: 'upcoming_sessions', arguments: { near: { lat: 48.85, lng: 2.35 }, radius_km: 5 } })).sessions).toEqual([]);
    expect(parse(await client.callTool({ name: 'upcoming_sessions', arguments: { query: 'samedi' } })).sessions.map((s: { name: string }) => s.name)).toContain('Rallye du samedi');
    await client.close();
  });

  it('compte les appels et les fiches ouvertes depuis un assistant, pour les relecteurs', async () => {
    const { entry } = await publishedEntry(ctx, 'camille@example.com');
    expect((await ctx.app.inject({ method: 'POST', url: '/api/mcp/visits', payload: { catalogId: entry.id } })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/mcp/visits', payload: { catalogId: 'x' } })).statusCode).toBe(400);

    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    expect((await ctx.app.inject({ url: '/api/mcp/stats' })).statusCode).toBe(401);
    expect((await zoe.get('/api/mcp/stats')).status).toBe(403);
    await ctx.pool.query(`UPDATE th_hunters SET htr_reviewer = true WHERE htr_email = 'seb@example.com'`);
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const stats = (await seb.get('/api/mcp/stats')).body;
    const search = stats.tools.find((t: { tool: string }) => t.tool === 'search_secret_tracks');
    expect(search).toMatchObject({ calls30: expect.any(Number), empty30: expect.any(Number) });
    expect(search.calls30).toBeGreaterThanOrEqual(2);
    expect(stats.tools.find((t: { tool: string }) => t.tool === 'get_secret_track').errors30).toBeGreaterThanOrEqual(1);
    expect(stats.visits30).toBeGreaterThanOrEqual(1);
    expect(stats.topVisited).toEqual(expect.arrayContaining([expect.objectContaining({ catalogId: entry.id, visits: 1 })]));
    expect(stats.daily).toHaveLength(30);
    // Rien de ce qui a été demandé n'est gardé : seulement l'outil et le nombre de résultats.
    const cols = (await ctx.pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'th_mcp_calls'`)).rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(['mcc_creation', 'mcc_error', 'mcc_id', 'mcc_results', 'mcc_tool']);
  });

  it('refuse GET et DELETE (serveur sans état)', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/mcp' })).statusCode).toBe(405);
    expect((await ctx.app.inject({ method: 'DELETE', url: '/api/mcp' })).statusCode).toBe(405);
  });
});
