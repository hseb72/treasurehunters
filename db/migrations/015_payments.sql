-- Paiement (docs/conception.md § 20) : Stripe Checkout pour les achats, Stripe Connect pour
-- reverser leur part aux créateurs et aux auteurs du catalogue. Inactif sans clés Stripe.

-- Compte Stripe Connect (Express) du vendeur, et s'il peut encaisser.
ALTER TABLE th_hunters ADD COLUMN htr_stripe_account varchar(64);
ALTER TABLE th_hunters ADD COLUMN htr_stripe_ready boolean NOT NULL DEFAULT false;

-- Prix d'une chasse du catalogue, fixé par son auteur (centimes ; 0 = gratuite).
ALTER TABLE th_catalog ADD COLUMN cat_price integer NOT NULL DEFAULT 0 CHECK (cat_price BETWEEN 0 AND 5000);

-- Un paiement : créé à l'ouverture du paiement Stripe, payé à la confirmation (webhook).
CREATE TABLE th_payments (
  pay_id          integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pay_hunter_htr  integer      NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  -- Produit acheté : « skin:medieval », « pack:u7 », « hunt:c12 » (chasse du catalogue).
  pay_product     varchar(60)  NOT NULL,
  pay_amount      integer      NOT NULL CHECK (pay_amount > 0),
  -- Commission de la plateforme, quand une part revient à un vendeur.
  pay_fee         integer      NOT NULL DEFAULT 0,
  pay_seller_htr  integer      REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  pay_session     varchar(255) UNIQUE,
  pay_status      varchar(7)   NOT NULL DEFAULT 'pending' CHECK (pay_status IN ('pending', 'paid', 'expired')),
  pay_creation    timestamptz  NOT NULL DEFAULT now(),
  pay_paid        timestamptz
);
CREATE INDEX fk_pay_htr_1 ON th_payments (pay_hunter_htr);
CREATE INDEX fk_pay_htr_2 ON th_payments (pay_seller_htr);
