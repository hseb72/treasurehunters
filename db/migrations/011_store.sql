-- Boutique d'extensions (docs/conception.md § 16) : ce que chaque joueur a obtenu, et les
-- outils de jeu installés sur chaque chasse.

-- Une extension obtenue (univers « skin:… », outil « tool:… »). Le prix payé est gardé :
-- 0 tant que l'acquisition est offerte.
CREATE TABLE th_purchases (
  pur_id          integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pur_hunter_htr  integer     NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  pur_product     varchar(60) NOT NULL,
  pur_price       integer     NOT NULL DEFAULT 0 CHECK (pur_price >= 0),
  pur_creation    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT un_pur_1 UNIQUE (pur_hunter_htr, pur_product)
);

-- Outils de jeu de la chasse. Les chasses existantes gardent le classement provisoire
-- qu'elles montraient déjà.
ALTER TABLE th_hunts ADD COLUMN hun_tools text[] NOT NULL DEFAULT '{live}';
