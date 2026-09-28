import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('reprendre une partie, fiche fidèle (§ 35)', () => {
  it('liste la partie en cours avec son étape, et la fiche donne distance et arrivées', async () => {
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
    const entry = (await seb.post(`/api/hunts/${huntId}/catalog`, { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null })).body;
    expect(entry.km).toBeGreaterThan(0);
    expect(entry.finishers).toBe(0);

    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const hunt = (await zoe.post(`/api/catalog/${entry.id}/play`)).body;
    expect((await zoe.get('/api/me/in-progress')).body.map((g: { huntId: number }) => g.huntId)).not.toContain(hunt.id); // pas encore partie
    await zoe.post(`/api/hunts/${hunt.id}/self-start`);
    const steps = (await ctx.pool.query('SELECT cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order > 0 ORDER BY cod_order', [hunt.id])).rows;
    await zoe.post(`/api/hunts/${hunt.id}/checkin`, { lat: steps[0].cod_latitude, lng: steps[0].cod_longitude, accuracy: 5 });
    const games = (await zoe.get('/api/me/in-progress')).body;
    expect(games.find((g: { huntId: number }) => g.huntId === hunt.id)).toMatchObject({ step: 2, totalSteps: 3, autonomous: true, name: expect.any(String), started: expect.any(String) });

    for (const s of steps.slice(1)) await zoe.post(`/api/hunts/${hunt.id}/checkin`, { lat: s.cod_latitude, lng: s.cod_longitude, accuracy: 5 });
    expect((await zoe.get('/api/me/in-progress')).body.map((g: { huntId: number }) => g.huntId)).not.toContain(hunt.id);
    expect((await zoe.get(`/api/catalog/${entry.id}`)).body.finishers).toBe(1);
  });
});
