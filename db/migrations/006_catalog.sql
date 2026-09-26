-- Catalogue de chasses, versions et notations. docs/conception.md § 13 et § 14.

-- ---------------------------------------------------------------- Catalogue

-- Une entrée = une version publiée d'une chasse. Son contenu est un instantané
-- (réglages et étapes) pris à la publication : l'auteur peut continuer à modifier
-- sa chasse sans changer ce que les autres copient.
CREATE TABLE th_catalog (
  cat_id          integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cat_author_htr  integer      NOT NULL REFERENCES th_hunters (htr_id),
  -- Chasse d'où vient la publication (ses parties comptent pour les notes de la version).
  cat_hunt_hun    integer      REFERENCES th_hunts (hun_id) ON DELETE SET NULL,
  -- Version précédente : celle qu'on avait copiée, ou la précédente publication de la même chasse.
  cat_parent_cat  integer      REFERENCES th_catalog (cat_id),
  cat_title       varchar(255) NOT NULL,
  cat_summary     text         NOT NULL,
  cat_location    varchar(255) NOT NULL,
  cat_difficulty  varchar(6)   NOT NULL CHECK (cat_difficulty IN ('easy', 'medium', 'hard')),
  cat_duration    smallint     NOT NULL CHECK (cat_duration BETWEEN 10 AND 1440), -- minutes, annoncées par l'auteur
  cat_stepcount   smallint     NOT NULL,
  cat_validation  varchar(3)   NOT NULL CHECK (cat_validation IN ('qr', 'geo')),
  -- Extrait : une énigme choisie par l'auteur, pour juger de la rédaction.
  cat_sample_order smallint    NOT NULL,
  cat_sample      text         NOT NULL,
  -- Ce qui change par rapport à la version précédente.
  cat_changes     text,
  cat_content     jsonb        NOT NULL,
  -- Empreinte du parcours : une copie non modifiée ne se republie pas.
  cat_fingerprint varchar(64)  NOT NULL,
  cat_withdrawn   timestamptz,
  cat_creation    timestamptz  NOT NULL DEFAULT now(),
  cat_lastupdate  timestamptz
);
CREATE INDEX fk_cat_htr_1 ON th_catalog (cat_author_htr);
CREATE INDEX fk_cat_cat_1 ON th_catalog (cat_parent_cat);
CREATE INDEX fk_cat_hun_1 ON th_catalog (cat_hunt_hun);

-- Chasse créée par copie d'une entrée du catalogue.
ALTER TABLE th_hunts ADD COLUMN hun_catalog_cat integer REFERENCES th_catalog (cat_id);
CREATE INDEX fk_hun_cat_1 ON th_hunts (hun_catalog_cat);

-- ---------------------------------------------------------------- Notations

-- Organisateur qui accepte d'être noté (second fil de notation, sur option).
ALTER TABLE th_hunters ADD COLUMN htr_rateable boolean NOT NULL DEFAULT false;

-- Avis d'un joueur sur une chasse jouée, après sa clôture. Il remonte à la version
-- du catalogue dont la chasse est issue (ou qu'elle a publiée).
CREATE TABLE th_ratings (
  rat_id          integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rat_hunt_hun    integer     NOT NULL REFERENCES th_hunts (hun_id) ON DELETE CASCADE,
  rat_hunter_htr  integer     NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  rat_stars       smallint    NOT NULL CHECK (rat_stars BETWEEN 1 AND 5),
  rat_riddles     smallint    NOT NULL CHECK (rat_riddles BETWEEN 1 AND 5),
  rat_route       smallint    NOT NULL CHECK (rat_route BETWEEN 1 AND 5),
  rat_mood        smallint    NOT NULL CHECK (rat_mood BETWEEN 1 AND 5),
  rat_comment     text        CHECK (length(rat_comment) <= 2000),
  -- Note de l'organisateur, seulement s'il accepte d'être noté.
  rat_organizer   smallint    CHECK (rat_organizer BETWEEN 1 AND 5),
  rat_creation    timestamptz NOT NULL DEFAULT now(),
  rat_lastupdate  timestamptz,
  CONSTRAINT un_rat_1 UNIQUE (rat_hunt_hun, rat_hunter_htr)
);
CREATE INDEX fk_rat_htr_1 ON th_ratings (rat_hunter_htr);
