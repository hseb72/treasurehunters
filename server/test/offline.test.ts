import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { offlineHash } from '../../shared/offline.js';
import { client, Ctx, DEMO_TOKENS, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe('mode hors ligne (§ 32)', () => {
  it('rejoue une partie en autonomie jouée sans réseau, à ses heures réelles', async () => {
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

    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const hunt = (await zoe.post(`/api/catalog/${id}/play`)).body;
    const pack = (await zoe.get(`/api/hunts/${hunt.id}/offline`)).body;
    expect(pack).toMatchObject({ huntId: hunt.id, validation: 'geo', selfStart: true, progress: { started: null, validated: [] } });
    expect(pack.steps).toHaveLength(4);
    expect(pack.steps[1]).toMatchObject({ order: 1, tokenHash: null, lat: expect.any(Number) });
    expect((await client(ctx.app).get(`/api/hunts/${hunt.id}/offline`)).status).toBe(401);

    const [, s1, s2, s3] = pack.steps;
    const events = [
      { id: 'a', kind: 'start', at: ago(50) },
      { id: 'b', kind: 'hint', stepId: pack.steps[0].stepId, at: ago(45) },
      { id: 'c', kind: 'arrive', stepId: s1.stepId, at: ago(40), lat: s1.lat, lng: s1.lng, accuracy: 5 },
      { id: 'd', kind: 'skip', stepId: s2.stepId, at: ago(30) },
    ];
    const tooFar = { id: 'e', kind: 'arrive', stepId: s3.stepId, at: ago(20), lat: s3.lat + 0.01, lng: s3.lng, accuracy: 5 };
    const first = (await zoe.post(`/api/hunts/${hunt.id}/offline/sync`, { events: [...events, tooFar] })).body;
    expect(first).toMatchObject({ applied: 4, rejected: { index: 4, reason: expect.stringContaining('trop loin') } });
    expect(first.state.clue.targetOrder).toBe(3);
    expect(first.state.hintsUsed).toBe(1);

    // Réponse perdue : le téléphone renvoie tout ; les actions déjà rejouées ne comptent pas deux fois.
    const arrive = { id: 'f', kind: 'arrive', stepId: s3.stepId, at: ago(20), lat: s3.lat, lng: s3.lng, accuracy: 5 };
    const second = (await zoe.post(`/api/hunts/${hunt.id}/offline/sync`, { events: [...events, arrive] })).body;
    expect(second).toMatchObject({ applied: 5, rejected: null });
    expect(second.state.team.finished).toBe(arrive.at);
    expect(Date.parse(second.state.team.started)).toBe(Date.parse(events[0]!.at));
    expect(second.state.hintsUsed).toBe(1);

    // Heures impossibles.
    const later = (await zoe.post(`/api/catalog/${id}/play`)).body;
    const bad = (await zoe.post(`/api/hunts/${later.id}/offline/sync`, { events: [{ id: 'x', kind: 'start', at: new Date(Date.now() + 3_600_000).toISOString() }] })).body;
    expect(bad.rejected.reason).toContain('Heure');
    expect((await zoe.post(`/api/hunts/${later.id}/offline/sync`, { events: [{ id: 'y', kind: 'dance', at: ago(1) }] })).status).toBe(400);
  });

  it('vérifie les QR scannés hors ligne sans jamais livrer les jetons', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const pack = (await seb.get('/api/hunts/1/offline')).body;
    expect(JSON.stringify(pack)).not.toContain(DEMO_TOKENS.nefles[3]);
    const last = pack.progress.validated.reduce((m: number, v: { order: number }) => Math.max(m, v.order), 0);
    const target = pack.steps.find((s: { order: number }) => s.order === last + 1);
    const token = DEMO_TOKENS.nefles[target.order]!;
    expect(target.tokenHash).toBe(await offlineHash(target.stepId, token));

    const wrong = (await seb.post('/api/hunts/1/offline/sync', { events: [{ id: 'q1', kind: 'scan', stepId: target.stepId, at: ago(1), token: 'faux' }] })).body;
    expect(wrong.rejected.reason).toContain('QR');
    const ok = (await seb.post('/api/hunts/1/offline/sync', { events: [{ id: 'q2', kind: 'scan', stepId: target.stepId, at: ago(1), token }] })).body;
    expect(ok).toMatchObject({ applied: 1, rejected: null });
    expect(ok.state.validated.map((v: { order: number }) => v.order)).toContain(target.order);
  });
});
