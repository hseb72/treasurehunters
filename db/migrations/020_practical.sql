-- Repères pratiques (docs/conception.md § 26) : poussette, fauteuil, toilettes, café sur le
-- parcours, et âge conseillé ; cochés par l'auteur sur la fiche de sa version du catalogue.
ALTER TABLE th_catalog
  ADD COLUMN cat_practical varchar(12)[] NOT NULL DEFAULT '{}',
  ADD COLUMN cat_minage smallint CHECK (cat_minage BETWEEN 2 AND 18);
