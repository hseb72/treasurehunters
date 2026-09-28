-- Analyse IA d'une étape problématique (docs/conception.md § 43) : une suggestion de plus,
-- décomptée comme les autres.
ALTER TABLE th_assists DROP CONSTRAINT th_assists_ass_action_check;
ALTER TABLE th_assists ADD CONSTRAINT th_assists_ass_action_check CHECK (ass_action IN ('rephrase', 'easier', 'harder', 'hints', 'review', 'diagnose'));
