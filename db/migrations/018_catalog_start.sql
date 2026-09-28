-- « Près de moi » (docs/conception.md § 23) : le point de départ de chaque version du
-- catalogue, pour trier par distance et placer les chasses sur une carte. C'est le premier
-- lieu placé du parcours (le départ, sinon la première étape), tiré de l'instantané publié.
ALTER TABLE th_catalog
  ADD COLUMN cat_lat double precision CHECK (cat_lat BETWEEN -90 AND 90),
  ADD COLUMN cat_lng double precision CHECK (cat_lng BETWEEN -180 AND 180);

UPDATE th_catalog c
SET cat_lat = s.lat, cat_lng = s.lng
FROM (
  SELECT DISTINCT ON (x.cat_id) x.cat_id, (st ->> 'latitude')::double precision AS lat, (st ->> 'longitude')::double precision AS lng
  FROM th_catalog x, jsonb_array_elements(x.cat_content -> 'steps') st
  WHERE st ->> 'latitude' IS NOT NULL AND st ->> 'longitude' IS NOT NULL
  ORDER BY x.cat_id, (st ->> 'order')::int
) s
WHERE s.cat_id = c.cat_id;
