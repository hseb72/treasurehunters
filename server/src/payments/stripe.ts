/**
 * Stripe (§ 20), sans SDK : l'API REST en formulaire encodé, et la vérification de la
 * signature des webhooks. Les clés viennent de l'environnement (STRIPE_*), jamais du dépôt.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CheckoutRequest {
  /** Nom affiché sur la page de paiement. */
  name: string;
  amount: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Notre paiement (th_payments), retrouvé à la confirmation. */
  paymentId: number;
  /** Vendeur (Stripe Connect) et commission de la plateforme, en centimes. */
  destination?: { account: string; fee: number };
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/** Ce dont l'application a besoin de Stripe : le vrai client, ou un double dans les tests. */
export interface PaymentProvider {
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  createAccount(email: string): Promise<string>;
  onboardingLink(account: string, returnUrl: string, refreshUrl: string): Promise<string>;
  accountReady(account: string): Promise<boolean>;
  /** Événement d'un webhook, après vérification de sa signature ; null si elle est fausse. */
  verifyEvent(payload: string, signature: string | undefined): StripeEvent | null;
}

/** Vérifie l'en-tête Stripe-Signature (« t=…,v1=… ») : HMAC-SHA256 de « t.payload », 5 minutes de tolérance. */
export function verifyStripeSignature(payload: string, header: string | undefined, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !signatures.length || Math.abs(now / 1000 - t) > 300) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex'));
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), expected));
}

/** Paramètres imbriqués en formulaire Stripe : { a: { b: 1 } } → « a[b]=1 ». */
export function formEncode(params: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(params).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) return [];
    if (typeof v === 'object') return formEncode(v as Record<string, unknown>, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });
}

export class StripeProvider implements PaymentProvider {
  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = formEncode(params).join('&');
    const res = await fetch(`https://api.stripe.com/v1/${path}${method === 'GET' && body ? `?${body}` : ''}`, {
      method,
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: method === 'POST' ? body : undefined,
    });
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe ${path} : ${res.status} ${json.error?.message ?? ''}`);
    return json;
  }

  async createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }> {
    const session = await this.call<{ id: string; url: string }>('POST', 'checkout/sessions', {
      mode: 'payment',
      customer_email: req.customerEmail,
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      client_reference_id: req.paymentId,
      metadata: { payment: req.paymentId },
      line_items: { 0: { quantity: 1, price_data: { currency: 'eur', unit_amount: req.amount, product_data: { name: req.name } } } },
      ...(req.destination
        ? { payment_intent_data: { application_fee_amount: req.destination.fee, transfer_data: { destination: req.destination.account }, metadata: { payment: req.paymentId } } }
        : {}),
    });
    return { id: session.id, url: session.url };
  }

  async createAccount(email: string): Promise<string> {
    const account = await this.call<{ id: string }>('POST', 'accounts', {
      type: 'express',
      country: 'FR',
      email,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });
    return account.id;
  }

  async onboardingLink(account: string, returnUrl: string, refreshUrl: string): Promise<string> {
    const link = await this.call<{ url: string }>('POST', 'account_links', { account, return_url: returnUrl, refresh_url: refreshUrl, type: 'account_onboarding' });
    return link.url;
  }

  async accountReady(account: string): Promise<boolean> {
    const a = await this.call<{ charges_enabled?: boolean }>('GET', `accounts/${encodeURIComponent(account)}`);
    return !!a.charges_enabled;
  }

  verifyEvent(payload: string, signature: string | undefined): StripeEvent | null {
    return verifyStripeSignature(payload, signature, this.webhookSecret) ? (JSON.parse(payload) as StripeEvent) : null;
  }
}
