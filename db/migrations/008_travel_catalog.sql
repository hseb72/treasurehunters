-- Déplacement, difficulté des énigmes et durée prévue d'une chasse, repris au catalogue
-- (carte, recherche). docs/conception.md § 11 et § 13.

ALTER TABLE th_hunts
  ADD COLUMN hun_travel     varchar(6) NOT NULL DEFAULT 'walk' CHECK (hun_travel IN ('walk', 'active', 'motor')),
  ADD COLUMN hun_difficulty varchar(6) CHECK (hun_difficulty IN ('easy', 'medium', 'hard')),
  ADD COLUMN hun_duration   smallint   CHECK (hun_duration BETWEEN 10 AND 1440);

ALTER TABLE th_catalog
  ADD COLUMN cat_travel varchar(6) NOT NULL DEFAULT 'walk' CHECK (cat_travel IN ('walk', 'active', 'motor'));
CREATE INDEX ix_cat_1 ON th_catalog (cat_travel, cat_duration);

-- Chasses générées : les souhaits de la demande.
UPDATE th_hunts h
SET hun_travel     = coalesce(g.gen_params ->> 'travel', 'walk'),
    hun_difficulty = g.gen_params ->> 'difficulty',
    hun_duration   = least(1440, greatest(10, (g.gen_params ->> 'durationMinutes')::int))
FROM th_generations g
WHERE g.gen_hunt_hun = h.hun_id AND g.gen_params ? 'durationMinutes';

-- Publications de chasses générées : la durée annoncée valait jusqu'ici 90 min par défaut.
UPDATE th_catalog c
SET cat_travel = h.hun_travel,
    cat_difficulty = coalesce(h.hun_difficulty, c.cat_difficulty),
    cat_duration = h.hun_duration
FROM th_hunts h
WHERE h.hun_id = c.cat_hunt_hun AND h.hun_duration IS NOT NULL;

-- Copies du catalogue : elles héritent de la version copiée.
UPDATE th_hunts h
SET hun_travel = c.cat_travel, hun_difficulty = coalesce(h.hun_difficulty, c.cat_difficulty), hun_duration = coalesce(h.hun_duration, c.cat_duration)
FROM th_catalog c
WHERE c.cat_id = h.hun_catalog_cat AND h.hun_duration IS NULL;
