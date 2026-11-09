import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, publishedEntry, setup, teardown } from './helpers.js';

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

const parse = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0]!.text);

describe('serveur MCP du catalogue (§ 50)', () => {
  it('se présente, liste trois outils en lecture seule', async () => {
    const client = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: 'secrettracks' });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_secret_track', 'search_secret_tracks', 'surprise_me']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    await client.close();
  });

  it('cherche, montre une fiche sans le parcours, et surprend', async () => {
    const { entry } = await publishedEntry(ctx, 'camille@example.com', { audience: ['family'] });
    const client = await connect();

    const found = parse(await client.callTool({ name: 'search_secret_tracks', arguments: { near: { lat: 43.6085, lng: 3.8795 }, audience: ['family'] } }));
    expect(found.hunts.map((h: { id: number }) => h.id)).toContain(entry.id);
    const hunt = found.hunts.find((h: { id: number }) => h.id === entry.id);
    expect(hunt).toMatchObject({ self_guided: true, audience: ['family'], url: expect.stringMatching(new RegExp(`/catalog/${entry.id}$`)), distance_km: expect.any(Number) });
    expect(parse(await client.callTool({ name: 'search_secret_tracks', arguments: { audience: ['couple'] } })).hunts.map((h: { id: number }) => h.id)).not.toContain(entry.id);

    const detail = parse(await client.callTool({ name: 'get_secret_track', arguments: { id: entry.id } }));
    expect(detail).toMatchObject({ id: entry.id, sample_riddle: expect.any(String), upcoming_sessions: [], reviews: [] });
    // Jamais le parcours : ni étapes, ni positions, ni réponses.
    const text = JSON.stringify(detail);
    for (const secret of ['latitude', 'longitude', 'instructions', 'hints', 'answer', 'content']) expect(text).not.toContain(`"${secret}"`);

    const missing = await client.callTool({ name: 'get_secret_track', arguments: { id: 999_999 } });
    expect(missing.isError).toBe(true);

    const surprise = parse(await client.callTool({ name: 'surprise_me', arguments: { near: { lat: 43.6085, lng: 3.8795 }, minutes: 120 } }));
    expect(surprise.hunt).not.toBeNull();
    expect(surprise.reasons.length).toBeGreaterThan(0);

    // Arguments invalides : une erreur d'outil, pas une panne.
    const bad = await client.callTool({ name: 'search_secret_tracks', arguments: { travel: ['plane'] } });
    expect(bad.isError).toBe(true);
    await client.close();
  });

  it('refuse GET et DELETE (serveur sans état)', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/mcp' })).statusCode).toBe(405);
    expect((await ctx.app.inject({ method: 'DELETE', url: '/api/mcp' })).statusCode).toBe(405);
  });
});
