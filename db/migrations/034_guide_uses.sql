-- Quotas du guide (docs/conception.md § 46) : chaque demande comprise par l'IA, pour un
-- joueur connecté, ou pour un visiteur sans compte (empreinte HMAC de son adresse IP, jamais
-- l'adresse elle-même). Les lignes de plus de 30 jours sont purgées au fil des demandes.
CREATE TABLE th_guide_uses (
  gui_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gui_hunter_htr integer REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  gui_visitor varchar(64),
  gui_creation timestamptz NOT NULL DEFAULT now(),
  CHECK (gui_hunter_htr IS NOT NULL OR gui_visitor IS NOT NULL)
);
CREATE INDEX ix_gui_hunter ON th_guide_uses (gui_hunter_htr, gui_creation);
CREATE INDEX ix_gui_visitor ON th_guide_uses (gui_visitor, gui_creation);

-- Clé de l'empreinte des visiteurs : tirée une fois, propre à cette base.
CREATE TABLE th_guide_key (gky_key text NOT NULL);
INSERT INTO th_guide_key (gky_key) VALUES (md5(random()::text || clock_timestamp()::text) || md5(random()::text));
