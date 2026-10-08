-- Photos d'étape venues de l'extérieur (§ 47) : crédit de l'auteur et licence (photos libres de
-- Wikimedia Commons, montré sous la photo), lien vers la page de la photo, et adresse d'origine
-- d'une photo importée par lien (jamais montrée aux joueurs : trace en cas de signalement).
ALTER TABLE th_codes ADD COLUMN cod_photocredit varchar(300);
ALTER TABLE th_codes ADD COLUMN cod_photocrediturl varchar(500);
ALTER TABLE th_codes ADD COLUMN cod_photosource varchar(1000);
