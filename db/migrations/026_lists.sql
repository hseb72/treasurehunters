-- Favoris et listes (docs/conception.md § 38) : la liste « À faire » de chaque joueur et ses
-- listes à lui, partageables par un code pour les remplir à plusieurs.
CREATE TABLE th_lists (
  lst_id serial PRIMARY KEY,
  lst_owner_htr integer NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  lst_name varchar(60) NOT NULL,
  lst_icon varchar(30) NOT NULL DEFAULT 'bookmark',
  lst_favorite boolean NOT NULL DEFAULT false,
  lst_code varchar(8) UNIQUE,
  lst_creation timestamptz NOT NULL DEFAULT now()
);
-- Une seule liste « À faire » par joueur.
CREATE UNIQUE INDEX th_lists_favorite ON th_lists (lst_owner_htr) WHERE lst_favorite;

CREATE TABLE th_list_members (
  lme_list_lst integer NOT NULL REFERENCES th_lists (lst_id) ON DELETE CASCADE,
  lme_hunter_htr integer NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  lme_creation timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lme_list_lst, lme_hunter_htr)
);

CREATE TABLE th_list_items (
  lit_list_lst integer NOT NULL REFERENCES th_lists (lst_id) ON DELETE CASCADE,
  lit_catalog_cat integer NOT NULL REFERENCES th_catalog (cat_id) ON DELETE CASCADE,
  lit_added_htr integer REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  lit_creation timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lit_list_lst, lit_catalog_cat)
);
