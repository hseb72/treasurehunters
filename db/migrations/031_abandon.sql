-- Abandon de la partie (docs/conception.md § 5.2) : toute l'équipe renonce, son chrono
-- s'arrête et elle n'est pas classée. L'abandon du trésor, lui, n'a pas besoin de colonne :
-- c'est une arrivée dont la dernière validation est un abandon (val_source = 'SKIP').
ALTER TABLE th_teams
  ADD COLUMN tea_abandoned    timestamptz,
  ADD COLUMN tea_abandoned_by integer REFERENCES th_hunters (htr_id) ON DELETE SET NULL;
