-- Rôles dans l'équipe (docs/conception.md § 41) : capitaine, navigateur, lecteur, déchiffreur,
-- photographe ; facultatifs, un seul capitaine par équipe.
ALTER TABLE th_teamhunters ADD COLUMN thr_role varchar(12) CHECK (thr_role IN ('captain', 'navigator', 'reader', 'solver', 'photographer'));
CREATE UNIQUE INDEX th_teamhunters_captain ON th_teamhunters (thr_team_tea) WHERE thr_role = 'captain';
