-- Usage du serveur MCP (docs/conception.md § 50) : chaque appel d'outil (sans ses arguments,
-- rien qui identifie l'utilisateur) et chaque visite d'une fiche ouverte depuis un lien donné
-- par un assistant. Gardé 180 jours, purgé au fil des appels.
CREATE TABLE th_mcp_calls (
  mcc_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mcc_tool varchar(40) NOT NULL,
  mcc_results integer,
  mcc_error boolean NOT NULL DEFAULT false,
  mcc_creation timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_mcc_creation ON th_mcp_calls (mcc_creation);

CREATE TABLE th_mcp_visits (
  mcv_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mcv_catalog_cat integer NOT NULL REFERENCES th_catalog (cat_id) ON DELETE CASCADE,
  mcv_creation timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_mcv_creation ON th_mcp_visits (mcv_creation);
