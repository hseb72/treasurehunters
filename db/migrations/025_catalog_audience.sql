-- Filtres « Je cherche une Secret Track… » (docs/conception.md § 36) : publics visés
-- (famille, couple, amis, seul, grand groupe) et cadre (extérieur, intérieur, les deux),
-- indiqués par l'auteur sur la fiche de sa version du catalogue.
ALTER TABLE th_catalog
  ADD COLUMN cat_audience varchar(12)[] NOT NULL DEFAULT '{}',
  ADD COLUMN cat_setting varchar(8) CHECK (cat_setting IN ('outdoor', 'indoor', 'mixed'));
