-- Photo du lieu montrée aux joueurs (docs/conception.md § 18).

-- La photo de l'étape (cod_refphoto) reste privée par défaut ; l'organisateur peut la montrer
-- à l'arrivée (avec le message d'arrivée) ou en tête de l'énigme qui mène au lieu.
ALTER TABLE th_codes ADD COLUMN cod_photoshow varchar(7) CHECK (cod_photoshow IN ('arrival', 'clue'));
