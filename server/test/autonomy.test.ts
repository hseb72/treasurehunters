import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

/** Une chasse géolocalisée partagée au catalogue par Seb (inventée, puis partagée telle quelle). */
async function geoEntry(): Promise<number> {
  const seb = await loginAs(ctx.app, 'seb@example.com');
  const job = await seb.post('/api/hunts/generate', {
    location: { query: 'Montpellier', lat: 43.6085, lng: 3.8795 },
    durationMinutes: 45,
    travel: 'walk',
    difficulty: 'easy',
    theme: null,
    steps: 3,
    mode: 'organize',
  });
  await ctx.app.service.settle();
  const huntId = (await seb.get(`/api/generations/${job.body.id}`)).body.huntId;
  const entry = await seb.post(`/api/hunts/${huntId}/catalog`, { summary: 'Balade en ville.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null });
  expect(entry.status).toBe(201);
  return entry.body.id;
}

/** Joue une partie jusqu'au trésor par « Je suis arrivé ». */
async function playThrough(api: Awaited<ReturnType<typeof loginAs>>, huntId: number) {
  const steps = (await ctx.pool.query('SELECT cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order > 0 ORDER BY cod_order', [huntId])).rows;
  let last;
  for (const s of steps) last = (await api.post(`/api/hunts/${huntId}/checkin`, { lat: s.cod_latitude, lng: s.cod_longitude, accuracy: 5 })).body;
  return last;
}

describe('jouer en autonomie', () => {
  it('trouve au catalogue les chasses sans organisateur, et les joue seul au moment choisi', async () => {
    const id = await geoEntry();
    const anyone = client(ctx.app);
    const autonomous = (await anyone.get('/api/catalog?autonomous=1')).body as { id: number; validation: string }[];
    expect(autonomous.map((e) => e.id)).toContain(id);
    expect(autonomous.every((e) => e.validation === 'geo')).toBe(true);
    const qr = (await anyone.get('/api/catalog')).body.find((e: { validation: string }) => e.validation === 'qr');
    if (qr) {
      const zoe = await loginAs(ctx.app, 'zoe@example.com');
      expect((await zoe.post(`/api/catalog/${qr.id}/play`)).status).toBe(409); // QR à poser : pas en autonomie
    }

    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const hunt = (await zoe.post(`/api/catalog/${id}/play`)).body;
    expect(hunt).toMatchObject({ surprise: true, status: 'published', selfPaced: true, catalogId: id, isPublic: false, validation: 'geo' });
    expect(Date.parse(hunt.end) - Date.now()).toBeGreaterThan(300 * 86_400_000); // lancée quand on veut, dans l'année
    // Achetée mais pas lancée : la même partie est reprise.
    expect((await zoe.post(`/api/catalog/${id}/play`)).body.id).toBe(hunt.id);
    expect((await zoe.get(`/api/hunts/${hunt.id}/steps`)).status).toBe(403); // le parcours reste secret
    const entry = (await zoe.get(`/api/catalog/${id}`)).body;
    expect(entry.myPlays).toEqual([{ huntId: hunt.id, started: null, finished: null, until: hunt.end }]);

    // Sur place, plus tard : le départ et le trésor.
    const before = (await zoe.get(`/api/hunts/${hunt.id}/play`)).body;
    expect(before).toMatchObject({ selfStart: true, clue: null, start: { lat: expect.any(Number) } });
    expect((await zoe.post(`/api/hunts/${hunt.id}/self-start`)).body.clue.targetOrder).toBe(1);
    const last = await playThrough(zoe, hunt.id);
    expect(last.step.isFinal).toBe(true);
    expect(last.state.hunt.status).toBe('closed');

    // Une nouvelle partie se crée ensuite (on peut la rejouer, en famille par exemple).
    expect((await zoe.post(`/api/catalog/${id}/play`)).body.id).not.toBe(hunt.id);
  });

  it('compare les joueurs qui ont fini la même chasse', async () => {
    const id = (await client(ctx.app).get('/api/catalog?autonomous=1')).body[0].id;
    const emma = await loginAs(ctx.app, 'emma@example.com');
    const hunt = (await emma.post(`/api/catalog/${id}/play`)).body;
    await emma.post(`/api/hunts/${hunt.id}/self-start`);
    await emma.post(`/api/hunts/${hunt.id}/hints`); // un joker : pénalité
    await playThrough(emma, hunt.id);

    const board = (await emma.get(`/api/catalog/${id}/leaderboard`)).body;
    expect(board.finishers).toBe(2);
    expect(board.players).toBeGreaterThanOrEqual(2);
    expect(board.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2]);
    const mine = board.rows.find((r: { mine: boolean }) => r.mine);
    expect(mine).toMatchObject({ teamName: 'Emma', hints: 1, penalty: expect.any(Number), members: 1 });
    expect(mine.penalty).toBeGreaterThan(0);
    expect(board.rows[0].time).toBeLessThanOrEqual(board.rows[1].time);
    expect((await client(ctx.app).get(`/api/catalog/${id}/leaderboard`)).body.rows.every((r: { mine: boolean }) => !r.mine));
  });
});
