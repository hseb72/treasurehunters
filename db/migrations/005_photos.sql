-- Preuve par photo : quand un QR a disparu ou a été abîmé, l'équipe photographie
-- le lieu qu'elle pense être la solution. docs/conception.md § 12.

-- Photo de référence de l'organisateur (clé de l'objet dans le stockage S3).
ALTER TABLE th_codes ADD COLUMN cod_refphoto varchar(200);

CREATE TABLE th_photos (
  pho_id              integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pho_team_tea        integer      NOT NULL REFERENCES th_teams (tea_id) ON DELETE CASCADE,
  pho_code_cod        integer      NOT NULL REFERENCES th_codes (cod_id) ON DELETE CASCADE,
  pho_hunter_htr      integer      REFERENCES th_hunters (htr_id) ON DELETE SET NULL, -- membre qui l'a envoyée
  -- Clé de l'objet dans le stockage ; NULL une fois la photo effacée (clôture + 30 jours).
  pho_key             varchar(200),
  -- Avis de l'IA : 'match' valide l'étape ; sinon l'équipe réessaie ou insiste.
  pho_verdict         varchar(12)  NOT NULL CHECK (pho_verdict IN ('match', 'nomatch', 'unavailable')),
  pho_reason          text,
  -- L'équipe a confirmé sa photo malgré l'avis de l'IA, à ses risques.
  pho_insisted        boolean      NOT NULL DEFAULT false,
  -- Contrôle de l'organisateur : NULL = à contrôler ; 'rejected' = épreuve comptée abandonnée.
  pho_review          varchar(8)   CHECK (pho_review IN ('approved', 'rejected')),
  pho_reviewed_by_htr integer      REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  pho_creation        timestamptz  NOT NULL DEFAULT now(),
  pho_lastupdate      timestamptz,
  CONSTRAINT ck_pho_insisted CHECK (NOT (pho_insisted AND pho_verdict = 'match'))
);
CREATE INDEX fk_pho_tea_1 ON th_photos (pho_team_tea);
CREATE INDEX fk_pho_cod_1 ON th_photos (pho_code_cod);

-- Une étape validée par photo porte sa photo, pour le contrôle de l'organisateur.
ALTER TABLE th_validations ADD COLUMN val_photo_pho integer REFERENCES th_photos (pho_id) ON DELETE SET NULL;
ALTER TABLE th_validations DROP CONSTRAINT ck_val_source;
ALTER TABLE th_validations
  ADD CONSTRAINT ck_val_source CHECK (val_source IN ('QR', 'MANUAL', 'SKIP', 'GEO', 'PHOTO'));
