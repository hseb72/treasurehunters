-- Génération payante (docs/conception.md § 21).

-- Membres fondateurs : génération sans formule (limites d'usage comprises).
-- UPDATE th_hunters SET htr_founder = true WHERE htr_email = '…';
ALTER TABLE th_hunters ADD COLUMN htr_founder boolean NOT NULL DEFAULT false;

-- Droits achetés (ou offerts) : crédits à l'unité, forfaits de 30 ou 365 jours.
CREATE TABLE th_genrights (
  grt_id          integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grt_hunter_htr  integer     NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  grt_kind        varchar(7)  NOT NULL CHECK (grt_kind IN ('credits', 'pass')),
  grt_credits     integer     NOT NULL DEFAULT 0 CHECK (grt_credits >= 0),
  grt_from        timestamptz,
  grt_until       timestamptz,
  grt_source      varchar(8)  NOT NULL DEFAULT 'purchase' CHECK (grt_source IN ('purchase', 'grant')),
  grt_payment_pay integer     REFERENCES th_payments (pay_id) ON DELETE SET NULL,
  grt_creation    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fk_grt_htr_1 ON th_genrights (grt_hunter_htr);

-- Ce qui a réglé chaque génération : gratuite, fondateur, forfait ou crédit.
ALTER TABLE th_generations ADD COLUMN gen_right varchar(7) NOT NULL DEFAULT 'free' CHECK (gen_right IN ('free', 'founder', 'pass', 'credit'));
