-- Défis étendus (docs/conception.md § 39) : le joueur qui lance un défi « bats mon temps »
-- y joint un mot ; les parties lancées depuis le défi le relèvent, et la fiche les suit.
CREATE TABLE th_challenges (
  chl_hunt_hun integer PRIMARY KEY REFERENCES th_hunts (hun_id) ON DELETE CASCADE,
  chl_author_htr integer REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  chl_message varchar(200),
  chl_creation timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE th_hunts ADD COLUMN hun_challenge_hun integer REFERENCES th_hunts (hun_id) ON DELETE SET NULL;
