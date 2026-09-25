-- Chasses surprises à plusieurs : coéquipiers et adversaires invités.
-- docs/conception.md § 11.4.

ALTER TABLE th_hunts
  -- Joueur qui a généré la chasse surprise (l'organisateur est le compte système).
  ADD COLUMN hun_host_htr  integer REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  -- Chasse surprise : chaque équipe donne son propre départ (true), ou l'hôte
  -- lance la course pour toutes les équipes en même temps (false).
  ADD COLUMN hun_selfpaced boolean NOT NULL DEFAULT true;

-- Chasses surprises existantes : l'hôte est le joueur inscrit.
UPDATE th_hunts h SET hun_host_htr = t.tea_owner_htr
FROM th_teams t
WHERE t.tea_hunt_hun = h.hun_id AND h.hun_surprise;

-- Celles qu'on peut encore jouer s'ouvrent aux équipes : l'équipe solo du
-- joueur devient une équipe que des coéquipiers peuvent rejoindre.
UPDATE th_teams SET tea_solo = false
WHERE tea_hunt_hun IN (SELECT hun_id FROM th_hunts WHERE hun_surprise AND hun_status_hst IN (2, 3));
UPDATE th_hunts SET hun_teamgame = true, hun_teammin = 1, hun_teammax = 6
WHERE hun_surprise AND hun_status_hst IN (2, 3);
