-- Version anglaise (docs/conception.md § 33) : traductions des textes des chasses (énigmes,
-- jokers, messages, fiches du catalogue), faites une fois par l'IA puis gardées ici.
CREATE TABLE th_translations (
  tr_lang     varchar(5)  NOT NULL,
  tr_hash     varchar(64) NOT NULL,
  tr_text     text        NOT NULL,
  tr_creation timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tr_lang, tr_hash)
);
