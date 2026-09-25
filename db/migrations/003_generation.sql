-- Chasses générées (OpenStreetMap + IA) et validation par géolocalisation.
-- docs/conception.md § 11.

ALTER TABLE th_hunts
  -- 'qr' : on scanne le QR posé sur place ; 'geo' : « Je suis arrivé » dans le rayon du lieu.
  ADD COLUMN hun_validation varchar(3) NOT NULL DEFAULT 'qr' CHECK (hun_validation IN ('qr', 'geo')),
  ADD COLUMN hun_georadius  smallint   NOT NULL DEFAULT 40 CHECK (hun_georadius BETWEEN 10 AND 500),
  -- Chasse inventée par le générateur.
  ADD COLUMN hun_generated  boolean    NOT NULL DEFAULT false,
  -- Chasse surprise : générée par un joueur pour lui-même, détail caché.
  ADD COLUMN hun_surprise   boolean    NOT NULL DEFAULT false;

-- Une arrivée validée par géolocalisation est une validation de source GEO.
ALTER TABLE th_validations DROP CONSTRAINT ck_val_source;
ALTER TABLE th_validations
  ADD CONSTRAINT ck_val_source CHECK (val_source IN ('QR', 'MANUAL', 'SKIP', 'GEO'));

-- Demandes de génération : traitées en tâche de fond (plusieurs dizaines de
-- secondes), suivies par le front, et comptées pour le quota par joueur.
CREATE TABLE th_generations (
  gen_id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  gen_hunter_htr integer     NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  gen_status     varchar(8)  NOT NULL DEFAULT 'pending' CHECK (gen_status IN ('pending', 'done', 'error')),
  gen_params     jsonb       NOT NULL,
  gen_hunt_hun   integer     REFERENCES th_hunts (hun_id) ON DELETE SET NULL,
  gen_error      text,
  gen_creation   timestamptz NOT NULL DEFAULT now(),
  gen_lastupdate timestamptz
);
CREATE INDEX ix_gen_1 ON th_generations (gen_hunter_htr, gen_creation);
