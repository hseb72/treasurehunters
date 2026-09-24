-- Abandon d'une épreuve (« 4ᵉ joker ») : l'équipe renonce au lieu qu'elle
-- cherche, moyennant une pénalité de temps, et accède à l'énigme suivante.
-- docs/conception.md § 5.2.

-- Pénalité par abandon, en minutes, réglée par chasse.
ALTER TABLE th_hunts
  ADD COLUMN hun_skippenalty smallint NOT NULL DEFAULT 30 CHECK (hun_skippenalty >= 0);

-- Une épreuve abandonnée est une validation de source SKIP (sans QR scanné).
ALTER TABLE th_validations DROP CONSTRAINT th_validations_val_source_check;
ALTER TABLE th_validations
  ADD CONSTRAINT ck_val_source CHECK (val_source IN ('QR', 'MANUAL', 'SKIP'));
