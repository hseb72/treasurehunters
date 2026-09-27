-- Skin de la chasse : l'habillage que voient ses joueurs (shared/skins.ts, docs/skins.md).
-- Les chasses existantes gardent l'univers « carnet d'explorateur » d'origine.
ALTER TABLE th_hunts ADD COLUMN hun_skin varchar(40) NOT NULL DEFAULT 'aventure';
