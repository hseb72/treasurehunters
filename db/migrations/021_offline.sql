-- Mode hors ligne (docs/conception.md § 32) : actions jouées sans réseau et déjà rejouées par
-- le serveur. Un téléphone qui renvoie la même action (réponse perdue) ne la compte pas deux fois.
CREATE TABLE th_offline (
  off_id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  off_team_tea   integer     NOT NULL REFERENCES th_teams (tea_id) ON DELETE CASCADE,
  off_event      varchar(40) NOT NULL,
  off_kind       varchar(8)  NOT NULL,
  off_at         timestamptz NOT NULL,
  off_hunter_htr integer     REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  off_creation   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT un_off_1 UNIQUE (off_team_tea, off_event)
);
