import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssistCase, RiddleWriter } from '../src/assist/writer.js';
import { Ctx, loginAs, publishedEntry, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

class FakeWriter implements RiddleWriter {
  last: AssistCase | null = null;
  async assist(c: AssistCase) {
    this.last = c;
    return { action: c.action, instructions: 'Énigme corrigée', hints: null, review: '- « ancienne porte » désigne deux lieux.' };
  }
}

describe('étapes problématiques et analyse IA (§ 43)', () => {
  it('l’IA reçoit ce que montrent les joueurs, et l’analyse compte une suggestion', async () => {
    const writer = new FakeWriter();
    ctx.app.service.writer = writer;
    const { entry, huntId, author } = await publishedEntry(ctx, 'seb@example.com');
    // Trois équipes en autonomie prennent un joker sur la première énigme.
    for (const email of ['zoe@example.com', 'hugo@example.com', 'lea@example.com']) {
      const p = await loginAs(ctx.app, email);
      const play = (await p.post(`/api/catalog/${entry.id}/play`)).body;
      await p.post(`/api/hunts/${play.id}/self-start`);
      expect((await p.post(`/api/hunts/${play.id}/hints`)).status).toBe(200);
      const s1 = (await ctx.pool.query('SELECT cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order = 1', [play.id])).rows[0];
      await p.post(`/api/hunts/${play.id}/checkin`, { lat: s1.cod_latitude, lng: s1.cod_longitude, accuracy: 5 });
    }
    const stats = (await author.get(`/api/catalog/${entry.id}/stats`)).body;
    expect(stats.steps[0]).toMatchObject({ order: 1, teams: 3, hints: 3, hintTeams: 3 });

    const start = (await author.get(`/api/hunts/${huntId}/steps`)).body.find((s: { order: number }) => s.order === 0);
    const res = await author.post(`/api/steps/${start.id}/assist`, { action: 'diagnose', instructions: start.instructions, hints: start.hints });
    expect(res.status).toBe(200);
    expect(res.body.suggestion).toMatchObject({ action: 'diagnose', instructions: 'Énigme corrigée', review: expect.stringContaining('ancienne porte') });
    expect(res.body.usage.byAction.diagnose).toBe(1);
    expect(writer.last?.evidence).toEqual(expect.arrayContaining(['100 % des équipes prennent un joker', expect.stringMatching(/^3 équipes ont cherché ce lieu/)]));
  });
});
