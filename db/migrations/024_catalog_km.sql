-- Fiche d'une Secret Track (docs/conception.md § 35) : longueur du parcours, en km à vol
-- d'oiseau d'un lieu au suivant (départ compris), calculée à la publication et rattrapée
-- ici depuis les instantanés déjà publiés.
ALTER TABLE th_catalog ADD COLUMN cat_km real CHECK (cat_km >= 0);

WITH pts AS (
  SELECT c.cat_id, (st ->> 'order')::int AS o, (st ->> 'latitude')::double precision AS lat, (st ->> 'longitude')::double precision AS lng
  FROM th_catalog c, jsonb_array_elements(c.cat_content -> 'steps') st
  WHERE st ->> 'latitude' IS NOT NULL AND st ->> 'longitude' IS NOT NULL
), legs AS (
  SELECT cat_id, lat, lng, lag(lat) OVER w AS plat, lag(lng) OVER w AS plng
  FROM pts WINDOW w AS (PARTITION BY cat_id ORDER BY o)
)
UPDATE th_catalog c SET cat_km = s.km
FROM (
  SELECT cat_id, sum(12742 * asin(sqrt(least(1, power(sin(radians(lat - plat) / 2), 2)
                 + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lng - plng) / 2), 2))))) AS km
  FROM legs WHERE plat IS NOT NULL GROUP BY cat_id
) s
WHERE s.cat_id = c.cat_id;
