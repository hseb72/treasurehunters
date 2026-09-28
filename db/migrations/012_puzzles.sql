-- Énigmes d'arrivée (docs/conception.md § 17).

-- Énigme posée sur une étape (JSON : type, consigne, réponse, indice, décalage).
ALTER TABLE th_codes ADD COLUMN cod_puzzle jsonb;

-- Équipe arrivée sur le lieu d'une étape à énigme, qui ne l'a pas encore résolue. La
-- validation (avec la source de l'arrivée) n'est enregistrée qu'à la bonne réponse.
CREATE TABLE th_arrivals (
  arr_id          integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  arr_team_tea    integer     NOT NULL REFERENCES th_teams (tea_id) ON DELETE CASCADE,
  arr_code_cod    integer     NOT NULL REFERENCES th_codes (cod_id) ON DELETE CASCADE,
  arr_hunter_htr  integer     REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  arr_source      varchar(6)  NOT NULL CHECK (arr_source IN ('QR', 'GEO', 'PHOTO')),
  arr_photo_pho   integer     REFERENCES th_photos (pho_id) ON DELETE SET NULL,
  arr_attempts    integer     NOT NULL DEFAULT 0,
  arr_hint        boolean     NOT NULL DEFAULT false,
  arr_creation    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT un_arr_1 UNIQUE (arr_team_tea, arr_code_cod)
);
CREATE INDEX fk_arr_cod_1 ON th_arrivals (arr_code_cod);
