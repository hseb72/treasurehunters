import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DemoGenerator } from '../src/generation/generator.js';
import { FakeStripe, signed } from './fake-stripe.js';
import { Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
let app: Awaited<ReturnType<typeof buildApp>>;
const stripe = new FakeStripe();

beforeAll(async () => {
  ctx = await setup();
  app = await buildApp(ctx.pool, { payments: stripe, generator: new DemoGenerator() });
});
afterAll(async () => {
  await app.close();
  await teardown(ctx);
});

const request = { location: { query: 'Montpellier', lat: 43.6085, lng: 3.8795 }, durationMinutes: 45, travel: 'walk', difficulty: 'easy', theme: null, steps: 3, mode: 'play' };

async function paid(productPath: string, api: Awaited<ReturnType<typeof loginAs>>) {
  await api.post(`/api/store/${productPath}/checkout`, { returnPath: '/generate' });
  const { payload, signature } = signed({ id: 'evt', type: 'checkout.session.completed', data: { object: { id: `cs_test_${stripe.checkouts.length}`, payment_status: 'paid' } } });
  await app.inject({ method: 'POST', url: '/api/payments/webhook', payload, headers: { 'content-type': 'application/json', 'stripe-signature': signature } });
}

async function generate(api: Awaited<ReturnType<typeof loginAs>>) {
  const res = await api.post('/api/hunts/generate', request);
  await app.service.settle();
  return res;
}

describe('Secret Track sur mesure payante', () => {
  it('reste gratuite sans paiement activé, dans la limite quotidienne', async () => {
    const lea = await loginAs(ctx.app, 'lea@example.com'); // application sans Stripe
    expect((await lea.get('/api/generation/access')).body).toMatchObject({ paid: false, right: 'free', blocked: null });
    expect((await generate(lea)).status).toBe(202);
  });

  it('demande une formule, puis consomme un crédit par Secret Track réussie', async () => {
    const zoe = await loginAs(app, 'zoe@example.com');
    const access = (await zoe.get('/api/generation/access')).body;
    expect(access).toMatchObject({ paid: true, founder: false, passUntil: null, right: null, blocked: null, credits: { available: 0 } });
    expect((await generate(zoe)).status).toBe(402);

    await paid('gen:single', zoe);
    expect(stripe.checkouts.at(-1)).toMatchObject({ name: 'Une Secret Track sur mesure', amount: 299, destination: undefined });
    expect((await zoe.get('/api/generation/access')).body).toMatchObject({ right: 'credit', credits: { purchased: 1, available: 1 } });
    expect((await generate(zoe)).status).toBe(202);
    expect((await zoe.get('/api/generation/access')).body).toMatchObject({ right: null, credits: { used: 1, available: 0 } });
    // Un crédit se rachète (ce n'est pas un produit qu'on possède une fois pour toutes).
    await paid('gen:single', zoe);
    expect((await zoe.get('/api/generation/access')).body.credits.available).toBe(1);
  });

  it('ouvre un forfait de 30 jours, prolongé par le suivant', async () => {
    const hugo = await loginAs(app, 'hugo@example.com');
    await paid('gen:month', hugo);
    const first = (await hugo.get('/api/generation/access')).body;
    expect(first.right).toBe('pass');
    const days = (Date.parse(first.passUntil) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    await paid('gen:month', hugo);
    const second = (await hugo.get('/api/generation/access')).body;
    expect((Date.parse(second.passUntil) - Date.now()) / 86_400_000).toBeGreaterThan(59.9);
    expect((await generate(hugo)).status).toBe(202);
    expect((await hugo.get('/api/generation/access')).body.usage.passPeriod).toBe(1);
    const gen = await ctx.pool.query(`SELECT gen_right FROM th_generations g JOIN th_hunters h ON h.htr_id = g.gen_hunter_htr WHERE h.htr_email = 'hugo@example.com'`);
    expect(gen.rows.map((r) => r.gen_right)).toEqual(['pass']);
  });

  it('laisse générer les fondateurs, mais pas au-delà de la limite quotidienne', async () => {
    await ctx.pool.query(`UPDATE th_hunters SET htr_founder = true WHERE htr_email = 'seb@example.com'`);
    const seb = await loginAs(app, 'seb@example.com');
    expect((await seb.get('/api/generation/access')).body).toMatchObject({ founder: true, right: 'founder' });
    for (let i = 0; i < 5; i++) expect((await generate(seb)).status).toBe(202);
    const blocked = (await seb.get('/api/generation/access')).body;
    expect(blocked).toMatchObject({ right: null, usage: { today: 5, daily: 5 } });
    expect(blocked.blocked).toMatch(/revenez demain/);
    expect((await generate(seb)).status).toBe(429);
  });

  it('offre des crédits aux créateurs dont les Secret Tracks partagées sont jouées par d’autres', async () => {
    const camille = await loginAs(app, 'camille@example.com');
    expect((await camille.get('/api/generation/access')).body).toMatchObject({ sharedPlayed: 0, credits: { bonus: 0 } });
    // Camille partage sa chasse de Palavas ; Emma la joue en autonomie jusqu'au bout.
    const entry = (await camille.post('/api/hunts/3/catalog', { summary: '', travel: 'walk', difficulty: 'medium', durationMinutes: 90, sampleOrder: 0, changes: null })).body;
    await ctx.pool.query(`UPDATE th_catalog SET cat_validation = 'geo' WHERE cat_id = $1`, [entry.id]);
    const emma = await loginAs(app, 'emma@example.com');
    const play = (await emma.post(`/api/catalog/${entry.id}/play`)).body;
    await ctx.pool.query(`UPDATE th_hunts SET hun_status_hst = 4 WHERE hun_id = $1`, [play.id]);
    expect((await camille.get('/api/generation/access')).body).toMatchObject({ sharedPlayed: 1, right: 'credit', credits: { bonus: 2, available: 2 } });
  });
});
