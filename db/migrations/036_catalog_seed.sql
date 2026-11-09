-- Parcours d'initialisation (docs/conception.md § 51) : la clé du fichier d'où vient une version
-- du catalogue. Un import ne duplique jamais une clé ; la fiche signale ces parcours comme pas
-- encore éprouvés sur place tant que trop peu d'équipes en sont arrivées.
ALTER TABLE th_catalog ADD COLUMN cat_seed varchar(80) UNIQUE;
