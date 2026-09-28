import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSIST_LIMITS } from '../../shared/assist.js';
import { AssistCase, RiddleWriter } from '../src/assist/writer.js';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

/** Rédacteur factice : garde la dernière demande, et échoue sur commande. */
class FakeWriter implements RiddleWriter {
  last: AssistCase | null = null;
  fail = false;
  async assist(c: AssistCase) {
    this.last = c;
    if (this.fail) throw new Error('panne');
    return {
      action: c.action,
      instructions: c.action === 'hints' ? null : `Version ${c.action}`,
      hints: c.action === 'hints' ? ['un', 'deux', 'trois'] : null,
      review: c.action === 'review' ? '- Deux fontaines possibles.' : null,
    };
  }
}

async function sebStep(order: number): Promise<number> {
  const r = await ctx.pool.query(
    `SELECT c.cod_id FROM th_codes c JOIN th_hunts h ON h.hun_id = c.cod_hunt_hun JOIN th_hunters u ON u.htr_id = h.hun_owner_htr
     WHERE u.htr_email = 'seb@example.com' AND c.cod_order = $1 ORDER BY h.hun_id LIMIT 1`,
    [order],
  );
  return r.rows[0].cod_id;
}

describe('assistant de rédaction (§ 25)', () => {
  it('propose sans appliquer, décompte chaque suggestion reçue, et rend celles qui échouent', async () => {
    const writer = new FakeWriter();
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const stepId = await sebStep(1);

    ctx.app.service.writer = null;
    expect((await seb.get('/api/features')).body.assist).toBe(false);
    expect((await seb.post(`/api/steps/${stepId}/assist`, { action: 'rephrase', instructions: 'x', hints: [] })).status).toBe(503);
    ctx.app.service.writer = writer;
    expect((await seb.get('/api/features')).body.assist).toBe(true);

    const before = (await seb.get('/api/assist/usage')).body;
    expect(before).toMatchObject({ plan: 'base', limit: ASSIST_LIMITS.monthly, used: 0, remaining: ASSIST_LIMITS.monthly, nextRefill: null });

    const res = await seb.post(`/api/steps/${stepId}/assist`, { action: 'hints', instructions: 'Cherchez la fontaine aux trois dauphins.', hints: ['', 'vieux joker'] });
    expect(res.status).toBe(200);
    expect(res.body.suggestion).toEqual({ action: 'hints', instructions: null, hints: ['un', 'deux', 'trois'], review: null });
    expect(res.body.usage).toMatchObject({ used: 1, remaining: ASSIST_LIMITS.monthly - 1, byAction: { hints: 1 } });
    // Le lieu à faire trouver est l'étape suivante ; les jokers vides ne partent pas.
    expect(writer.last).toMatchObject({ action: 'hints', from: { title: expect.any(String) }, target: { title: expect.any(String) }, hints: ['vieux joker'] });
    // Rien n'est enregistré sur l'étape.
    const hints = (await ctx.pool.query('SELECT cod_hint1 FROM th_codes WHERE cod_id = $1', [stepId])).rows[0].cod_hint1;
    expect(hints).not.toBe('un');

    // Une panne ne compte pas.
    writer.fail = true;
    expect((await seb.post(`/api/steps/${stepId}/assist`, { action: 'review', instructions: 'Énigme.', hints: [] })).status).toBe(502);
    writer.fail = false;
    expect((await seb.get('/api/assist/usage')).body.used).toBe(1);

    // Une énigme vide : seulement une première proposition.
    expect((await seb.post(`/api/steps/${stepId}/assist`, { action: 'harder', instructions: ' ', hints: [] })).status).toBe(400);
    expect((await seb.post(`/api/steps/${stepId}/assist`, { action: 'rephrase', instructions: '', hints: [] })).status).toBe(200);
  });

  it('réserve l’assistant à l’organisateur, et bloque au-delà du quota', async () => {
    ctx.app.service.writer = new FakeWriter();
    const stepId = await sebStep(1);
    expect((await client(ctx.app).post(`/api/steps/${stepId}/assist`, { action: 'rephrase', instructions: 'x', hints: [] })).status).toBe(401);
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    expect([403, 404]).toContain((await zoe.post(`/api/steps/${stepId}/assist`, { action: 'rephrase', instructions: 'x', hints: [] })).status);

    // Arrivée : pas d'énigme à écrire.
    const last = (
      await ctx.pool.query('SELECT c.cod_id FROM th_codes c WHERE c.cod_hunt_hun = (SELECT cod_hunt_hun FROM th_codes WHERE cod_id = $1) ORDER BY c.cod_order DESC LIMIT 1', [stepId])
    ).rows[0].cod_id;
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.post(`/api/steps/${last}/assist`, { action: 'rephrase', instructions: 'x', hints: [] })).status).toBe(400);

    const me = (await ctx.pool.query(`SELECT htr_id FROM th_hunters WHERE htr_email = 'seb@example.com'`)).rows[0].htr_id;
    await ctx.pool.query(`INSERT INTO th_assists (ass_hunter_htr, ass_action, ass_creation) SELECT $1, 'rephrase', now() - interval '2 days' FROM generate_series(1, $2)`, [
      me,
      ASSIST_LIMITS.monthly,
    ]);
    const usage = (await seb.get('/api/assist/usage')).body;
    expect(usage.remaining).toBe(0);
    expect(usage.blocked).toContain('30 derniers jours');
    const blocked = await seb.post(`/api/steps/${stepId}/assist`, { action: 'rephrase', instructions: 'x', hints: [] });
    expect(blocked.status).toBe(429);

    // Fondateur : limite élargie.
    await ctx.pool.query('UPDATE th_hunters SET htr_founder = true WHERE htr_id = $1', [me]);
    expect((await seb.get('/api/assist/usage')).body).toMatchObject({ plan: 'founder', limit: ASSIST_LIMITS.passMonthly, blocked: null });
    expect((await seb.post(`/api/steps/${stepId}/assist`, { action: 'rephrase', instructions: 'x', hints: [] })).status).toBe(200);
  });
});
