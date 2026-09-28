import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('souvenir de fin de partie (§ 24)', () => {
  it('se prépare à l’arrivée, avec le rang parmi les joueurs en autonomie', async () => {
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
    const id = (await seb.post(`/api/hunts/${huntId}/catalog`, { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null })).body.id;

    const play = async (email: string, hint: boolean) => {
      const api = await loginAs(ctx.app, email);
      const hunt = (await api.post(`/api/catalog/${id}/play`)).body;
      await api.post(`/api/hunts/${hunt.id}/self-start`);
      if (hint) await api.post(`/api/hunts/${hunt.id}/hints`);
      expect((await api.get(`/api/hunts/${hunt.id}/souvenir`)).status).toBe(409); // pas encore arrivé
      const steps = (await ctx.pool.query('SELECT cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order > 0 ORDER BY cod_order', [hunt.id])).rows;
      for (const s of steps) await api.post(`/api/hunts/${hunt.id}/checkin`, { lat: s.cod_latitude, lng: s.cod_longitude, accuracy: 5 });
      return { api, huntId: hunt.id as number };
    };
    await play('zoe@example.com', false);
    const emma = await play('emma@example.com', true);

    const res = await emma.api.get(`/api/hunts/${emma.huntId}/souvenir`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      huntId: emma.huntId,
      teamName: expect.any(String),
      scope: 'catalog',
      ranked: 2,
      rank: 2, // un joker de pénalité : derrière Zoé
      found: 3,
      totalSteps: 3,
      hints: 1,
      provisional: false,
      catalogId: id,
    });
    expect(res.body.penalty).toBeGreaterThan(0);
    expect(res.body.trail).toHaveLength(4); // départ + 3 lieux
    for (const [x, y] of res.body.trail) expect(Math.max(x, y)).toBeLessThanOrEqual(1);

    // Carnet d'explorateur (§ 29) : la partie finie, sa ville, ses badges.
    const journal = (await emma.api.get('/api/me/journal')).body;
    expect(journal.hunts[0]).toMatchObject({ huntId: emma.huntId, found: 3, hints: 1, autonomous: true, catalogId: id });
    expect(journal.hunts[0].km).toBeGreaterThan(0);
    expect(journal.cities).toContain('Montpellier');
    expect(journal.badges.filter((b: { earned: boolean }) => b.earned).map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining(['first', 'solo']));
    expect((await client(ctx.app).get('/api/me/journal')).status).toBe(401);

    // Réservé à l'équipe.
    expect((await client(ctx.app).get(`/api/hunts/${emma.huntId}/souvenir`)).status).toBe(401);
    const louis = await loginAs(ctx.app, 'louis@example.com');
    expect((await louis.get(`/api/hunts/${emma.huntId}/souvenir`)).status).toBeGreaterThanOrEqual(403);
  });
});
