import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, loginAs, publishedEntry, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

async function playThrough(ctx: Ctx, player: Awaited<ReturnType<typeof loginAs>>, huntId: number) {
  await player.post(`/api/hunts/${huntId}/self-start`);
  const steps = (await ctx.pool.query('SELECT cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order > 0 ORDER BY cod_order', [huntId])).rows;
  for (const s of steps) await player.post(`/api/hunts/${huntId}/checkin`, { lat: s.cod_latitude, lng: s.cod_longitude, accuracy: 5 });
}

describe('défis étendus (§ 39)', () => {
  it('un mot du lanceur, et le suivi de ceux qui relèvent le défi', async () => {
    const { entry } = await publishedEntry(ctx, 'camille@example.com');
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const mine = (await zoe.post(`/api/catalog/${entry.id}/play`)).body;
    // Pas de défi tant que la partie n'est pas finie.
    expect((await zoe.put(`/api/catalog/${entry.id}/challenge/${mine.id}`, { message: 'Trop tôt' })).status).toBe(404);
    await playThrough(ctx, zoe, mine.id);

    const dare = (await zoe.put(`/api/catalog/${entry.id}/challenge/${mine.id}`, { message: '  Tu penses pouvoir faire mieux ?  ' })).body;
    expect(dare).toMatchObject({ message: 'Tu penses pouvoir faire mieux ?', authorNickname: expect.any(String), takers: [] });
    const hugo = await loginAs(ctx.app, 'hugo@example.com');
    expect((await hugo.put(`/api/catalog/${entry.id}/challenge/${mine.id}`, { message: 'pirate' })).status).toBe(403);

    const taken = (await hugo.post(`/api/catalog/${entry.id}/play`, { challenge: mine.id })).body;
    let board = (await hugo.get(`/api/catalog/${entry.id}/challenge/${mine.id}`)).body;
    expect(board.takers).toEqual([expect.objectContaining({ status: 'waiting', time: null, beaten: null, mine: true })]);
    // Un défi d'une autre version n'existe pas.
    expect((await hugo.post(`/api/catalog/${entry.id + 999}/play`, { challenge: mine.id })).status).toBe(404);

    await playThrough(ctx, hugo, taken.id);
    board = (await ctx.app.inject({ url: `/api/catalog/${entry.id}/challenge/${mine.id}` })).json();
    expect(board.takers).toEqual([expect.objectContaining({ status: 'finished', time: expect.any(Number), beaten: expect.any(Boolean), mine: false })]);
  });
});
