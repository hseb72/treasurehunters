-- Centres d'intérêt de l'équipe (§ 46), dits au guide : catégories ajoutées en tête du volet
-- « Autour de moi » (§ 45). Liste de { label, filters: [{ key, values }] }, filtrée par le serveur.
ALTER TABLE th_teams ADD COLUMN tea_interests jsonb NOT NULL DEFAULT '[]';
