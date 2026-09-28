import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('près de moi (§ 23)', () => {
  it('donne le départ des chasses, la distance, et filtre par rayon', async () => {
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
    const entry = await seb.post(`/api/hunts/${huntId}/catalog`, { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null });
    expect(entry.status).toBe(201);
    const id = entry.body.id as number;
    expect(entry.body.start).toMatchObject({ lat: expect.closeTo(43.6, 0), lng: expect.closeTo(3.9, 0) });
    expect(entry.body.distanceKm).toBeNull();

    const anyone = client(ctx.app);
    const near = (await anyone.get('/api/catalog?lat=43.61&lng=3.88&radius=10&sort=distance')).body as { id: number; distanceKm: number }[];
    expect(near.map((e) => e.id)).toContain(id);
    expect(near.find((e) => e.id === id)!.distanceKm).toBeLessThan(10);
    const dists = near.map((e) => e.distanceKm);
    expect(dists).toEqual([...dists].sort((a, b) => a - b));

    // Depuis Paris : à plus de 500 km, hors d'un rayon de 10 km, mais listée sans rayon.
    expect((await anyone.get('/api/catalog?lat=48.8566&lng=2.3522&radius=10')).body.map((e: { id: number }) => e.id)).not.toContain(id);
    const all = (await anyone.get('/api/catalog?lat=48.8566&lng=2.3522&sort=distance')).body as { id: number; distanceKm: number | null }[];
    expect(all.find((e) => e.id === id)!.distanceKm).toBeGreaterThan(500);

    expect((await anyone.get('/api/catalog?lat=95&lng=0')).status).toBe(400);
    // Tri par distance sans position : repli sur les mieux notées.
    expect((await anyone.get('/api/catalog?sort=distance')).status).toBe(200);
  });
});
