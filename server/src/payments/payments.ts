/**
 * Paiement (§ 20) : achat des extensions de la boutique et des chasses du catalogue par
 * Stripe Checkout ; la part des créateurs et des auteurs leur est versée par Stripe Connect,
 * moins la commission de la plateforme. Sans Stripe configuré, rien de tout cela n'est actif.
 */
import pg from 'pg';
import { creationProductId, creationRef } from '../../../shared/creations.js';
import { CheckoutResult, PayoutAccount, StoreItem } from '../../../shared/models.js';
import { productById } from '../../../shared/store.js';
import { generationOffer } from '../../../shared/generation-access.js';
import { grantOffer } from '../generation/access.js';
import { config } from '../config.js';
import { publishedCreation } from '../creations.js';
import { one, tx } from '../db.js';
import { conflict, HttpError, notFound, unauthorized } from '../errors.js';
import { PaymentProvider } from './stripe.js';

type Viewer = number | null;

/** Un produit à vendre : prix, nom, et le vendeur à qui reverser sa part (null = la plateforme). */
export interface Sellable {
  id: string;
  name: string;
  price: number;
  sellerId: number | null;
}

/** Chasse du catalogue vendue par son auteur : « hunt:c12 ». */
export function catalogProductId(catalogId: number): string {
  return `hunt:c${catalogId}`;
}

export class Payments {
  constructor(
    private readonly pool: pg.Pool,
    readonly provider: PaymentProvider | null,
    /** Boutique du joueur, après un achat. */
    private readonly store: (viewer: Viewer) => Promise<StoreItem[]>,
    private readonly log: (err: unknown, msg: string) => void,
  ) {}

  get enabled(): boolean {
    return !!this.provider;
  }

  /** Ce que coûte un produit, et à qui revient la vente ; null s'il n'existe pas. */
  async sellable(productId: string): Promise<Sellable | null> {
    const hunt = /^hunt:c(\d{1,9})$/.exec(productId);
    if (hunt) {
      const r = await one(this.pool, 'SELECT cat_title, cat_price, cat_author_htr, cat_withdrawn FROM th_catalog WHERE cat_id = $1', [Number(hunt[1])]);
      return r && !r['cat_withdrawn'] ? { id: productId, name: `Secret Track « ${r['cat_title']} »`, price: r['cat_price'], sellerId: r['cat_author_htr'] } : null;
    }
    const offer = generationOffer(productId);
    if (offer) return { id: productId, name: offer.name, price: offer.price, sellerId: null };
    const ref = creationRef(productId);
    if (ref !== null) {
      const c = await publishedCreation(this.pool, ref);
      return c && creationProductId(c.kind, c.id) === productId ? { id: productId, name: c.name, price: c.price, sellerId: c.authorId } : null;
    }
    const p = productById(productId);
    return p ? { id: p.id, name: p.name, price: p.included ? 0 : p.price, sellerId: null } : null;
  }

  private async owned(me: number, productId: string): Promise<boolean> {
    return !!(await one(this.pool, 'SELECT 1 FROM th_purchases WHERE pur_hunter_htr = $1 AND pur_product = $2', [me, productId]));
  }

  /**
   * Ouvre le paiement d'un produit. Gratuit, déjà possédé ou vendu par soi-même : obtenu tout
   * de suite (url null). Sinon, une page Stripe Checkout ; la possession suit sa confirmation.
   */
  async checkout(viewer: Viewer, productId: string, returnPath: string): Promise<CheckoutResult> {
    if (viewer === null) throw unauthorized();
    if (!this.provider) throw new HttpError(503, 'Le paiement n’est pas activé : les extensions sont offertes.');
    const item = await this.sellable(productId);
    if (!item) throw notFound('Produit inconnu.');
    // Chasse sur mesure (§ 21) : crédits et forfaits se rachètent, ils ne se « possèdent » pas.
    const consumable = !!generationOffer(productId);
    if (!consumable && (item.price === 0 || item.sellerId === viewer || (await this.owned(viewer, productId)))) {
      if (item.price === 0 && !productById(productId)?.included) {
        await this.pool.query('INSERT INTO th_purchases (pur_hunter_htr, pur_product, pur_price) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING', [viewer, productId]);
      }
      return { url: null, items: await this.store(viewer) };
    }
    let destination: { account: string; fee: number } | undefined;
    if (item.sellerId !== null) {
      const seller = await one(this.pool, 'SELECT htr_stripe_account, htr_stripe_ready FROM th_hunters WHERE htr_id = $1', [item.sellerId]);
      if (!seller?.['htr_stripe_account'] || !seller['htr_stripe_ready']) throw conflict('Son auteur n’a pas encore activé la vente : revenez bientôt.');
      destination = { account: seller['htr_stripe_account'], fee: Math.round((item.price * config.stripe.commissionPercent) / 100) };
    }
    const email = (await one(this.pool, 'SELECT htr_email FROM th_hunters WHERE htr_id = $1', [viewer]))!['htr_email'];
    const pay = await one(
      this.pool,
      'INSERT INTO th_payments (pay_hunter_htr, pay_product, pay_amount, pay_fee, pay_seller_htr) VALUES ($1, $2, $3, $4, $5) RETURNING pay_id',
      [viewer, productId, item.price, destination?.fee ?? 0, item.sellerId],
    );
    const back = (state: string) => `${config.appUrl}${returnPath}${returnPath.includes('?') ? '&' : '?'}paid=${state}&product=${encodeURIComponent(productId)}`;
    const session = await this.provider.createCheckout({
      name: item.name,
      amount: item.price,
      customerEmail: email,
      successUrl: back('1'),
      cancelUrl: back('0'),
      paymentId: pay!['pay_id'],
      destination,
    });
    await this.pool.query('UPDATE th_payments SET pay_session = $2 WHERE pay_id = $1', [pay!['pay_id'], session.id]);
    return { url: session.url, items: [] };
  }

  /** Webhook Stripe : paiement confirmé → produit obtenu ; compte vendeur mis à jour. */
  async webhook(payload: string, signature: string | undefined): Promise<{ received: true }> {
    if (!this.provider) throw notFound('Paiement non activé.');
    const event = this.provider.verifyEvent(payload, signature);
    if (!event) throw new HttpError(400, 'Signature Stripe invalide.');
    const o = event.data.object;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (o['payment_status'] !== 'paid') return { received: true };
      await tx(this.pool, async (db) => {
        const pay = await one(db, `SELECT * FROM th_payments WHERE pay_session = $1 FOR UPDATE`, [o['id']]);
        if (!pay || pay['pay_status'] === 'paid') return;
        await db.query(`UPDATE th_payments SET pay_status = 'paid', pay_paid = now() WHERE pay_id = $1`, [pay['pay_id']]);
        const offer = generationOffer(pay['pay_product']);
        if (offer) {
          await grantOffer(db, pay['pay_hunter_htr'], offer, pay['pay_id']);
          return;
        }
        await db.query(
          'INSERT INTO th_purchases (pur_hunter_htr, pur_product, pur_price) VALUES ($1, $2, $3) ON CONFLICT (pur_hunter_htr, pur_product) DO UPDATE SET pur_price = EXCLUDED.pur_price',
          [pay['pay_hunter_htr'], pay['pay_product'], pay['pay_amount']],
        );
      });
    } else if (event.type === 'checkout.session.expired') {
      await this.pool.query(`UPDATE th_payments SET pay_status = 'expired' WHERE pay_session = $1 AND pay_status = 'pending'`, [o['id']]);
    } else if (event.type === 'account.updated') {
      await this.pool.query('UPDATE th_hunters SET htr_stripe_ready = $2 WHERE htr_stripe_account = $1', [o['id'], !!o['charges_enabled']]);
    }
    return { received: true };
  }

  /** Compte vendeur du joueur : pour encaisser ses créations et ses chasses du catalogue. */
  async account(viewer: Viewer): Promise<PayoutAccount> {
    if (viewer === null) throw unauthorized();
    const r = (await one(this.pool, 'SELECT htr_stripe_account, htr_stripe_ready FROM th_hunters WHERE htr_id = $1', [viewer]))!;
    let ready = !!r['htr_stripe_ready'];
    // Retour de l'inscription : Stripe dit si le compte peut déjà encaisser.
    if (this.provider && r['htr_stripe_account'] && !ready) {
      ready = await this.provider.accountReady(r['htr_stripe_account']).catch((e) => {
        this.log(e, 'Compte Stripe illisible');
        return false;
      });
      if (ready) await this.pool.query('UPDATE th_hunters SET htr_stripe_ready = true WHERE htr_id = $1', [viewer]);
    }
    return { enabled: this.enabled, account: !!r['htr_stripe_account'], ready, commissionPercent: config.stripe.commissionPercent };
  }

  /** Inscription (ou reprise) chez Stripe Connect : l'adresse de la page Stripe. */
  async onboard(viewer: Viewer, returnPath: string): Promise<{ url: string }> {
    if (viewer === null) throw unauthorized();
    if (!this.provider) throw new HttpError(503, 'Le paiement n’est pas activé.');
    const r = (await one(this.pool, 'SELECT htr_email, htr_stripe_account FROM th_hunters WHERE htr_id = $1', [viewer]))!;
    let account = r['htr_stripe_account'] as string | null;
    if (!account) {
      account = await this.provider.createAccount(r['htr_email']);
      await this.pool.query('UPDATE th_hunters SET htr_stripe_account = $2, htr_stripe_ready = false WHERE htr_id = $1', [viewer, account]);
    }
    const url = `${config.appUrl}${returnPath}`;
    return { url: await this.provider.onboardingLink(account, url, url) };
  }
}
