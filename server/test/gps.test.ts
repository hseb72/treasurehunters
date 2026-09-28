import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, loginAs, publishedEntry, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('mode test : fiabilité GPS par étape (§ 42)', () => {
  it('note les tests de l’auteur et les arrivées des joueurs, et signale une étape instable', async () => {
    const { huntId, author, entry } = await publishedEntry(ctx, 'seb@example.com');
    const steps = (await author.get(`/api/hunts/${huntId}/steps`)).body as { id: number; order: number; latitude: number; longitude: number }[];
    const s1 = steps.find((s) => s.order === 1)!;
    const at = (meters: number) => ({ lat: s1.latitude + meters / 111_320, lng: s1.longitude, accuracy: 12 });

    // Trois tests à ~30 m : validés, mais loin du point.
    for (let i = 0; i < 3; i++) expect((await author.post(`/api/steps/${s1.id}/test`, at(30))).body).toMatchObject({ ok: true });
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    expect((await zoe.post(`/api/steps/${s1.id}/test`, at(0))).status).toBeGreaterThanOrEqual(403);

    // Un joueur en autonomie : un « Je suis arrivé » refusé à 500 m, puis un bon.
    const play = (await zoe.post(`/api/catalog/${entry.id}/play`)).body;
    await zoe.post(`/api/hunts/${play.id}/self-start`);
    await zoe.post(`/api/hunts/${play.id}/checkin`, at(500));
    await zoe.post(`/api/hunts/${play.id}/checkin`, at(2));

    const report = (await author.get(`/api/hunts/${huntId}/gps`)).body;
    const r1 = report.find((r: { order: number }) => r.order === 1);
    // La partie en autonomie suit le même parcours : ses arrivées comptent.
    expect(r1).toMatchObject({ tests: 3, plays: 2, triggered: 4, far: 3, failed: 1, accuracy: 12, unstable: true });
    expect(r1.reasons[0]).toMatch(/plus de 20 m/);
    expect((await zoe.get(`/api/hunts/${huntId}/gps`)).status).toBeGreaterThanOrEqual(403);
  });
});
