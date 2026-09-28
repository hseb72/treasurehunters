-- Signalements d'étape (docs/conception.md § 22) : un joueur prévient l'organisateur ou
-- l'auteur qu'un lieu a changé (fermé, travaux), qu'un QR manque ou qu'une énigme est fausse.
CREATE TABLE th_reports (
  rep_id           integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rep_hunt_hun     integer      NOT NULL REFERENCES th_hunts (hun_id) ON DELETE CASCADE,
  rep_code_cod     integer      NOT NULL REFERENCES th_codes (cod_id) ON DELETE CASCADE,
  rep_hunter_htr   integer      REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  rep_category     varchar(8)   NOT NULL CHECK (rep_category IN ('closed', 'works', 'qr', 'riddle', 'danger', 'other')),
  rep_message      varchar(500),
  rep_status       varchar(8)   NOT NULL DEFAULT 'open' CHECK (rep_status IN ('open', 'resolved')),
  rep_resolved     timestamptz,
  rep_resolver_htr integer      REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  rep_creation     timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX fk_rep_hun_1 ON th_reports (rep_hunt_hun);
CREATE INDEX fk_rep_cod_1 ON th_reports (rep_code_cod);
