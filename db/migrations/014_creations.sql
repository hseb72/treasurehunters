-- Ouverture aux créateurs (docs/conception.md § 19, docs/skins.md).

-- Relecteurs : ceux qui publient ou refusent les créations proposées.
-- UPDATE th_hunters SET htr_reviewer = true WHERE htr_email = '…';
ALTER TABLE th_hunters ADD COLUMN htr_reviewer boolean NOT NULL DEFAULT false;

-- Skin ou pack d'énigmes proposé par un créateur ; contenu = manifeste déclaratif contrôlé.
CREATE TABLE th_creations (
  cre_id           integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cre_author_htr   integer      NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  cre_kind         varchar(4)   NOT NULL CHECK (cre_kind IN ('skin', 'pack')),
  cre_name         varchar(40)  NOT NULL,
  cre_description  varchar(300) NOT NULL DEFAULT '',
  cre_price        integer      NOT NULL DEFAULT 0 CHECK (cre_price BETWEEN 0 AND 2000),
  cre_content      jsonb        NOT NULL,
  cre_status       varchar(9)   NOT NULL DEFAULT 'draft' CHECK (cre_status IN ('draft', 'review', 'published', 'rejected')),
  cre_note         varchar(500),
  cre_reviewer_htr integer      REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  cre_published    timestamptz,
  cre_creation     timestamptz  NOT NULL DEFAULT now(),
  cre_lastupdate   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX fk_cre_htr_1 ON th_creations (cre_author_htr);
CREATE INDEX ix_cre_status ON th_creations (cre_status);
