import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('repères pratiques (§ 26)', () => {
  it('se cochent à la publication, se corrigent sur la fiche et filtrent le catalogue', async () => {
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
    const pub = { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null };
    const entry = await seb.post(`/api/hunts/${huntId}/catalog`, { ...pub, practical: ['stroller', 'toilets', 'stroller'], minAge: 6 });
    expect(entry.status).toBe(201);
    expect(entry.body).toMatchObject({ practical: ['stroller', 'toilets'], minAge: 6 });
    const id = entry.body.id;

    const anyone = client(ctx.app);
    const ids = async (q: string) => (await anyone.get(`/api/catalog?${q}`)).body.map((e: { id: number }) => e.id);
    expect(await ids('practical=stroller')).toContain(id);
    expect(await ids('practical=stroller,toilets')).toContain(id);
    expect(await ids('practical=wheelchair')).not.toContain(id);
    expect((await anyone.get('/api/catalog?practical=piscine')).status).toBe(400);

    // Même parcours republié : la fiche se corrige, sans nouvelle version.
    const again = await seb.post(`/api/hunts/${huntId}/catalog`, { ...pub, practical: ['wheelchair'], minAge: null });
    expect(again.body).toMatchObject({ id, practical: ['wheelchair'], minAge: null });
    expect((await seb.post(`/api/hunts/${huntId}/catalog`, { ...pub, minAge: 1 })).status).toBe(400);
  });
});
