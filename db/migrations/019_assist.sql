-- Assistant de rédaction (docs/conception.md § 25) : chaque suggestion réussie de l'IA dans
-- l'éditeur. Le décompte (30 jours glissants, et 24 heures) se lit dans cette table.
CREATE TABLE th_assists (
  ass_id         integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ass_hunter_htr integer     NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  ass_hunt_hun   integer     REFERENCES th_hunts (hun_id) ON DELETE SET NULL,
  ass_action     varchar(8)  NOT NULL CHECK (ass_action IN ('rephrase', 'easier', 'harder', 'hints', 'review')),
  ass_creation   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ass_1 ON th_assists (ass_hunter_htr, ass_creation);
CREATE INDEX fk_ass_hun_1 ON th_assists (ass_hunt_hun);
