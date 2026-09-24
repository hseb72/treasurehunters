-- Treasure Hunters — schéma initial PostgreSQL (docs/conception.md § 6).
-- Conventions héritées de la première version : préfixe th_, trigramme par table,
-- clés étrangères nommées <colonne>_<trigramme cible>, colonnes _creation / _lastupdate.
-- Toutes les dates sont des timestamptz (stockées en UTC).

-- ---------------------------------------------------------------- Joueurs

CREATE TABLE th_hunters (
  htr_id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  htr_nickname      varchar(50)  NOT NULL CHECK (length(trim(htr_nickname)) > 0),
  htr_email         varchar(255) NOT NULL CHECK (htr_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  htr_emailverified timestamptz,
  htr_creation      timestamptz  NOT NULL DEFAULT now(),
  htr_lastupdate    timestamptz
);
-- Unicité insensible à la casse.
CREATE UNIQUE INDEX un_htr_1 ON th_hunters (lower(htr_nickname));
CREATE UNIQUE INDEX un_htr_2 ON th_hunters (lower(htr_email));

CREATE TABLE th_secrets (
  sec_id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sec_hunter_htr integer NOT NULL UNIQUE REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  sec_password   text    NOT NULL, -- hash argon2id, jamais le mot de passe en clair
  sec_extauth    varchar(255),
  sec_pushauth   varchar(255),
  sec_creation   timestamptz NOT NULL DEFAULT now(),
  sec_lastupdate timestamptz
);

CREATE TABLE th_sessions (
  ses_id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ses_hunter_htr integer  NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  ses_tokenhash  char(64) NOT NULL UNIQUE, -- SHA-256 hexadécimal du jeton envoyé au client
  ses_expires    timestamptz NOT NULL,
  ses_useragent  varchar(255),
  ses_creation   timestamptz NOT NULL DEFAULT now(),
  ses_lastupdate timestamptz
);
CREATE INDEX fk_ses_htr_1 ON th_sessions (ses_hunter_htr);

-- ---------------------------------------------------------------- Chasses

CREATE TABLE th_huntstatus (
  hst_id          smallint PRIMARY KEY,
  hst_code        varchar(20) NOT NULL UNIQUE, -- valeur exposée par l'API
  hst_name        varchar(50) NOT NULL,
  hst_description text,
  hst_creation    timestamptz NOT NULL DEFAULT now(),
  hst_lastupdate  timestamptz
);

INSERT INTO th_huntstatus (hst_id, hst_code, hst_name, hst_description) VALUES
  (1, 'draft',     'Brouillon', 'En cours de création, invisible des joueurs'),
  (2, 'published', 'Publiée',   'Visible, inscriptions ouvertes'),
  (3, 'running',   'En cours',  'Départ donné, QR codes actifs'),
  (4, 'closed',    'Close',     'Terminée, résultats publiés'),
  (5, 'cancelled', 'Annulée',   'N''aura pas lieu'),
  (6, 'archived',  'Archivée',  'Conservée pour l''historique');

CREATE TABLE th_hunts (
  hun_id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hun_owner_htr    integer      NOT NULL REFERENCES th_hunters (htr_id),
  hun_name         varchar(50)  NOT NULL,
  hun_description  text         NOT NULL DEFAULT '',
  hun_location     varchar(255) NOT NULL DEFAULT '',
  hun_begin        timestamptz  NOT NULL, -- dates prévues
  hun_end          timestamptz  NOT NULL,
  hun_started      timestamptz,           -- horodatages réels
  hun_closed       timestamptz,
  hun_autostart    boolean      NOT NULL DEFAULT false,
  hun_autoclose    boolean      NOT NULL DEFAULT false,
  hun_award        text,
  hun_starttext    text,
  hun_startmode    smallint     NOT NULL DEFAULT 1 CHECK (hun_startmode IN (1, 2)), -- 1 groupé, 2 échelonné
  hun_interval     smallint     CHECK (hun_interval > 0),                          -- minutes entre deux départs
  hun_penalty1     smallint     NOT NULL DEFAULT 0 CHECK (hun_penalty1 >= 0),      -- minutes par joker de niveau 1
  hun_penalty2     smallint     NOT NULL DEFAULT 0 CHECK (hun_penalty2 >= 0),
  hun_penalty3     smallint     NOT NULL DEFAULT 0 CHECK (hun_penalty3 >= 0),
  hun_teamgame     boolean      NOT NULL DEFAULT true,
  hun_teammin      smallint     NOT NULL DEFAULT 1 CHECK (hun_teammin >= 1),
  hun_teammax      smallint     NOT NULL DEFAULT 4,
  hun_public       boolean      NOT NULL DEFAULT true,
  hun_joincode     varchar(12)  NOT NULL UNIQUE,
  hun_contribution numeric(10, 2) NOT NULL DEFAULT 0 CHECK (hun_contribution >= 0),
  hun_status_hst   smallint     NOT NULL DEFAULT 1 REFERENCES th_huntstatus (hst_id),
  hun_creation     timestamptz  NOT NULL DEFAULT now(),
  hun_lastupdate   timestamptz,
  CONSTRAINT ck_hun_dates CHECK (hun_end > hun_begin),
  CONSTRAINT ck_hun_team CHECK (hun_teammax >= hun_teammin),
  CONSTRAINT ck_hun_interval CHECK (hun_startmode = 1 OR hun_interval IS NOT NULL)
);
CREATE INDEX fk_hun_htr_1 ON th_hunts (hun_owner_htr);
CREATE INDEX fk_hun_hst_1 ON th_hunts (hun_status_hst);

-- Étapes : ordre 0 = départ (sans QR), ordre max = arrivée.
CREATE TABLE th_codes (
  cod_id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cod_hunt_hun     integer      NOT NULL REFERENCES th_hunts (hun_id) ON DELETE CASCADE,
  cod_order        smallint     NOT NULL CHECK (cod_order >= 0),
  cod_longid       varchar(32)  UNIQUE, -- jeton aléatoire du QR code
  cod_title        varchar(255) NOT NULL,
  cod_arrival      text,                -- message affiché au scan
  cod_instructions text,                -- énigme menant à l'étape suivante
  cod_hint1        text,
  cod_hint2        text,
  cod_hint3        text,
  cod_answer       varchar(255),        -- réservé : énigme à réponse (évolution future)
  cod_latitude     numeric(9, 6),
  cod_longitude    numeric(9, 6),
  cod_address      varchar(255),
  cod_creation     timestamptz NOT NULL DEFAULT now(),
  cod_lastupdate   timestamptz,
  CONSTRAINT ck_cod_token CHECK ((cod_order = 0) = (cod_longid IS NULL)),
  -- Différable pour pouvoir réordonner les étapes dans une transaction.
  CONSTRAINT un_cod_2 UNIQUE (cod_hunt_hun, cod_order) DEFERRABLE INITIALLY IMMEDIATE
);

-- ---------------------------------------------------------------- Équipes

-- Dans une chasse en solo, chaque joueur forme une équipe d'une personne (tea_solo).
CREATE TABLE th_teams (
  tea_id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tea_hunt_hun    integer      NOT NULL REFERENCES th_hunts (hun_id) ON DELETE CASCADE,
  tea_name        varchar(255) NOT NULL,
  tea_description text,
  tea_owner_htr   integer      NOT NULL REFERENCES th_hunters (htr_id), -- capitaine
  tea_joincode    varchar(12)  NOT NULL UNIQUE,
  tea_solo        boolean      NOT NULL DEFAULT false,
  tea_startorder  smallint     CHECK (tea_startorder > 0),
  tea_started     timestamptz,
  tea_finished    timestamptz,
  tea_creation    timestamptz  NOT NULL DEFAULT now(),
  tea_lastupdate  timestamptz,
  CONSTRAINT un_tea_1 UNIQUE (tea_hunt_hun, tea_name),
  CONSTRAINT un_tea_2 UNIQUE (tea_id, tea_hunt_hun) -- cible de la clé composite de th_teamhunters
);

CREATE TABLE th_teamhunters (
  thr_id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thr_team_tea   integer NOT NULL,
  thr_hunt_hun   integer NOT NULL,
  thr_hunter_htr integer NOT NULL REFERENCES th_hunters (htr_id) ON DELETE CASCADE,
  thr_creation   timestamptz NOT NULL DEFAULT now(),
  thr_lastupdate timestamptz,
  CONSTRAINT fk_thr_tea_1 FOREIGN KEY (thr_team_tea, thr_hunt_hun)
    REFERENCES th_teams (tea_id, tea_hunt_hun) ON DELETE CASCADE,
  -- Un joueur appartient à une seule équipe par chasse.
  CONSTRAINT un_thr_1 UNIQUE (thr_hunt_hun, thr_hunter_htr)
);
CREATE INDEX fk_thr_tea_1 ON th_teamhunters (thr_team_tea);
CREATE INDEX fk_thr_htr_1 ON th_teamhunters (thr_hunter_htr);

-- ---------------------------------------------------------------- Progression

CREATE TABLE th_validations (
  val_id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  val_team_tea   integer    NOT NULL REFERENCES th_teams (tea_id) ON DELETE CASCADE,
  val_code_cod   integer    NOT NULL REFERENCES th_codes (cod_id) ON DELETE CASCADE,
  val_hunter_htr integer    NOT NULL REFERENCES th_hunters (htr_id), -- membre qui a scanné
  val_source     varchar(6) NOT NULL DEFAULT 'QR' CHECK (val_source IN ('QR', 'MANUAL')),
  val_by_htr     integer    REFERENCES th_hunters (htr_id),          -- organisateur (validation manuelle)
  val_creation   timestamptz NOT NULL DEFAULT now(),                 -- heure de passage
  CONSTRAINT un_val_1 UNIQUE (val_team_tea, val_code_cod),
  CONSTRAINT ck_val_manual CHECK ((val_source = 'MANUAL') = (val_by_htr IS NOT NULL))
);
CREATE INDEX fk_val_cod_1 ON th_validations (val_code_cod);

CREATE TABLE th_hintuses (
  hiu_id         integer  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hiu_team_tea   integer  NOT NULL REFERENCES th_teams (tea_id) ON DELETE CASCADE,
  hiu_code_cod   integer  NOT NULL REFERENCES th_codes (cod_id) ON DELETE CASCADE,
  hiu_level      smallint NOT NULL CHECK (hiu_level BETWEEN 1 AND 3),
  hiu_hunter_htr integer  NOT NULL REFERENCES th_hunters (htr_id),
  hiu_creation   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT un_hiu_1 UNIQUE (hiu_team_tea, hiu_code_cod, hiu_level)
);

-- Journal de toutes les tentatives de scan (audit, triche, litiges).
CREATE TABLE th_scanlog (
  scl_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scl_code_cod   integer REFERENCES th_codes (cod_id) ON DELETE SET NULL,
  scl_token      varchar(64) NOT NULL,
  scl_hunter_htr integer REFERENCES th_hunters (htr_id) ON DELETE SET NULL,
  scl_team_tea   integer REFERENCES th_teams (tea_id) ON DELETE SET NULL,
  scl_result     varchar(20) NOT NULL,
  scl_ip         inet,
  scl_creation   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_scl_1 ON th_scanlog (scl_code_cod, scl_creation);
