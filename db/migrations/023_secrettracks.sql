-- Nouveau nom de l'application (SecretTracks) : le compte système qui organise les parties
-- en autonomie prend ce nom, s'il est libre.
UPDATE th_hunters SET htr_nickname = 'SecretTracks'
WHERE htr_email = 'generateur@treasurehunters.invalid'
  AND NOT EXISTS (SELECT 1 FROM th_hunters WHERE lower(htr_nickname) = 'secrettracks');
