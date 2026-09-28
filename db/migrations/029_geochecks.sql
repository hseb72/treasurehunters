-- Fiabilité GPS par étape (docs/conception.md § 42) : chaque « Je suis arrivé » d'un joueur et
-- chaque vérification de l'auteur en répétition, avec la distance au point et la précision
-- annoncée par le téléphone.
CREATE TABLE th_geochecks (
  gck_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gck_code_cod integer NOT NULL REFERENCES th_codes (cod_id) ON DELETE CASCADE,
  gck_hunter_htr integer REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  gck_source varchar(4) NOT NULL CHECK (gck_source IN ('play', 'test')),
  gck_distance integer NOT NULL,
  gck_allowed integer NOT NULL,
  gck_accuracy real,
  gck_ok boolean NOT NULL,
  gck_creation timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_gck_code ON th_geochecks (gck_code_cod);
