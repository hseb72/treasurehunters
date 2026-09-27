-- Autres points d'où une étape se valide par géolocalisation : les entrées d'un parc,
-- d'un musée, d'une église… Un lieu fermé reste validable depuis ses abords.
-- docs/conception.md § 11.3. Tableau JSON de { "lat": …, "lng": … }.
ALTER TABLE th_codes ADD COLUMN cod_entrances jsonb;
