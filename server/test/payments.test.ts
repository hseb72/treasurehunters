import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { formEncode, verifyStripeSignature } from '../src/payments/stripe.js';
import { FakeStripe, SECRET, signed } from './fake-stripe.js';
import { Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
let app: Awaited<ReturnType<typeof buildApp>>;
const stripe = new FakeStripe();

async function webhook(event: object, secret = SECRET) {
  const { payload, signature } = signed(event, secret);
  return app.inject({ method: 'POST', url: '/api/payments/webhook', payload, headers: { 'content-type': 'application/json', 'stripe-signature': signature } });
}
const paid = (session: string) => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: session, payment_status: 'paid' } } });

beforeAll(async () => {
  ctx = await setup();
  app = await buildApp(ctx.pool, { payments: stripe });
  await ctx.pool.query(`UPDATE th_hunters SET htr_reviewer = true WHERE htr_email = 'seb@example.com'`);
});
afterAll(async () => {
  await app.close();
  await teardown(ctx);
});

describe('signature Stripe', () => {
  it('accepte une signature juste et récente, refuse le reste', () => {
    const { payload, signature } = signed({ a: 1 });
    expect(verifyStripeSignature(payload, signature, SECRET)).toBe(true);
    expect(verifyStripeSignature(payload + ' ', signature, SECRET)).toBe(false);
    expect(verifyStripeSignature(payload, signature, 'whsec_autre')).toBe(false);
    expect(verifyStripeSignature(payload, signature, SECRET, Date.now() + 10 * 60_000)).toBe(false);
    expect(verifyStripeSignature(payload, undefined, SECRET)).toBe(false);
  });

  it('encode les paramètres imbriqués comme Stripe les attend', () => {
    expect(formEncode({ a: 1, b: { c: 'x y', d: { 0: true } }, e: undefined })).toEqual(['a=1', 'b%5Bc%5D=x%20y', 'b%5Bd%5D%5B0%5D=true']);
  });
});

describe('paiement', () => {
  it('reste inactif sans Stripe : tout est offert', async () => {
    const bare = await buildApp(ctx.pool, { payments: null });
    const zoe = await loginAs(bare, 'zoe@example.com');
    expect((await zoe.get('/api/features')).body.payments).toBe(false);
    expect((await zoe.post('/api/store/skin:pirates/checkout', {})).status).toBe(503);
    expect((await zoe.post('/api/store/skin:pirates/acquire')).status).toBe(200);
    await bare.close();
  });

  it('fait payer une extension, et ne la donne qu’à la confirmation signée', async () => {
    const zoe = await loginAs(app, 'zoe@example.com');
    expect((await zoe.get('/api/features')).body.payments).toBe(true);
    expect((await zoe.post('/api/store/skin:medieval/acquire')).status).toBe(402);

    const checkout = await zoe.post('/api/store/skin:medieval/checkout', { returnPath: '/store' });
    expect(checkout.body).toEqual({ url: 'https://checkout.stripe.test/1', items: [] });
    expect(stripe.checkouts[0]).toMatchObject({ name: 'Médiéval', amount: 299, customerEmail: 'zoe@example.com', destination: undefined });
    expect(stripe.checkouts[0].successUrl).toMatch(/\/store\?paid=1&product=skin%3Amedieval$/);
    expect((await zoe.post('/api/store/skin:medieval/checkout', { returnPath: '//ailleurs.example' })).status).toBe(400);

    const owned = async () => (await zoe.get('/api/store')).body.find((i: { id: string }) => i.id === 'skin:medieval').owned;
    expect(await owned()).toBe(false);
    expect((await webhook(paid('cs_test_1'), 'whsec_faux')).statusCode).toBe(400);
    expect(await owned()).toBe(false);
    expect((await webhook(paid('cs_test_1'))).statusCode).toBe(200);
    expect((await webhook(paid('cs_test_1'))).statusCode).toBe(200); // rejouée : sans effet
    expect(await owned()).toBe(true);
    const purchase = await ctx.pool.query(`SELECT pur_price FROM th_purchases p JOIN th_hunters h ON h.htr_id = p.pur_hunter_htr WHERE h.htr_email = 'zoe@example.com' AND pur_product = 'skin:medieval'`);
    expect(purchase.rows).toEqual([{ pur_price: 299 }]);

    // Gratuit ou déjà possédé : rien à payer.
    expect((await zoe.post('/api/store/pack:question/checkout', {})).body.url).toBeNull();
    expect((await zoe.post('/api/store/skin:medieval/checkout', {})).body.url).toBeNull();
  });

  it('reverse sa part au créateur, moins la commission, une fois son compte vendeur prêt', async () => {
    const camille = await loginAs(app, 'camille@example.com');
    const seb = await loginAs(app, 'seb@example.com');
    const zoe = await loginAs(app, 'zoe@example.com');
    const cover = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';
    const skin = (await camille.post('/api/creations', { kind: 'skin', name: 'Brume', description: '', price: 199, content: { tokens: { ink: '#222' }, cover } })).body;
    await camille.post(`/api/creations/${skin.id}/submit`);
    await seb.post(`/api/creations/${skin.id}/review`, { approve: true, note: null });

    expect((await zoe.post(`/api/store/skin:u${skin.id}/checkout`, {})).status).toBe(409); // vendeuse pas encore inscrite
    expect((await camille.get('/api/payments/account')).body).toEqual({ enabled: true, account: false, ready: false, commissionPercent: 20 });
    const onboarding = (await camille.post('/api/payments/account', { returnPath: '/creator?stripe=retour' })).body;
    expect(onboarding.url).toMatch(/^https:\/\/connect\.stripe\.test\/acct_1\?return=.*creator%3Fstripe%3Dretour$/);
    stripe.ready.add('acct_1');
    expect((await camille.get('/api/payments/account')).body).toMatchObject({ account: true, ready: true });

    await zoe.post(`/api/store/skin:u${skin.id}/checkout`, {});
    expect(stripe.checkouts.at(-1)).toMatchObject({ amount: 199, destination: { account: 'acct_1', fee: 40 } });
    // L'autrice obtient sa propre création sans payer.
    expect((await camille.post(`/api/store/skin:u${skin.id}/checkout`, {})).body.url).toBeNull();

    // Stripe suspend le compte : la vente s'arrête.
    await webhook({ id: 'evt_2', type: 'account.updated', data: { object: { id: 'acct_1', charges_enabled: false } } });
    expect((await ctx.pool.query(`SELECT htr_stripe_ready FROM th_hunters WHERE htr_stripe_account = 'acct_1'`)).rows[0].htr_stripe_ready).toBe(false);
  });

  it('fait acheter une Secret Track payante du catalogue avant de la copier', async () => {
    const camille = await loginAs(app, 'camille@example.com');
    const zoe = await loginAs(app, 'zoe@example.com');
    const entry = (await camille.post('/api/hunts/1/catalog', { summary: '', travel: 'walk', difficulty: 'medium', durationMinutes: 90, sampleOrder: 0, changes: null, price: 500 })).body;
    expect(entry.price).toBe(500);
    await ctx.pool.query(`UPDATE th_hunters SET htr_stripe_ready = true WHERE htr_email = 'camille@example.com'`);

    expect((await zoe.post(`/api/catalog/${entry.id}/copy`)).status).toBe(402);
    const checkout = (await zoe.post(`/api/store/hunt:c${entry.id}/checkout`, { returnPath: `/catalog/${entry.id}` })).body;
    expect(checkout.url).toBeTruthy();
    expect(stripe.checkouts.at(-1)).toMatchObject({ amount: 500, destination: { fee: 100 } });
    await webhook(paid(`cs_test_${stripe.checkouts.length}`));
    expect((await zoe.post(`/api/catalog/${entry.id}/copy`)).status).toBe(201);
    expect((await camille.post(`/api/catalog/${entry.id}/copy`)).status).toBe(201); // l'autrice ne paie pas
  });
});
