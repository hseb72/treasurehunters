import { createHmac } from 'node:crypto';
import { CheckoutRequest, PaymentProvider, StripeEvent, verifyStripeSignature } from '../src/payments/stripe.js';

export const SECRET = 'whsec_test';

/** Stripe simulé : garde les demandes de paiement, signe et vérifie comme le vrai. */
export class FakeStripe implements PaymentProvider {
  checkouts: CheckoutRequest[] = [];
  ready = new Set<string>();
  accounts = 0;
  async createCheckout(req: CheckoutRequest) {
    this.checkouts.push(req);
    return { id: `cs_test_${this.checkouts.length}`, url: `https://checkout.stripe.test/${this.checkouts.length}` };
  }
  async createAccount() {
    return `acct_${++this.accounts}`;
  }
  async onboardingLink(account: string, returnUrl: string) {
    return `https://connect.stripe.test/${account}?return=${encodeURIComponent(returnUrl)}`;
  }
  async accountReady(account: string) {
    return this.ready.has(account);
  }
  verifyEvent(payload: string, signature: string | undefined): StripeEvent | null {
    return verifyStripeSignature(payload, signature, SECRET) ? JSON.parse(payload) : null;
  }
}

export function signed(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  return { payload, signature: `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}` };
}

