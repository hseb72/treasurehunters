import { HuntStatus, ScanOutcome, StartMode } from '../core/models';

export const STATUS_LABELS: Record<HuntStatus, string> = {
  draft: 'Brouillon',
  published: 'Inscriptions ouvertes',
  running: 'En cours',
  closed: 'Terminée',
  cancelled: 'Annulée',
  archived: 'Archivée',
};

export const STATUS_ICONS: Record<HuntStatus, string> = {
  draft: 'edit_note',
  published: 'campaign',
  running: 'explore',
  closed: 'flag',
  cancelled: 'block',
  archived: 'inventory_2',
};

export const START_MODE_LABELS: Record<StartMode, string> = {
  mass: 'Départ groupé',
  staggered: 'Départs échelonnés',
};

export const SCAN_LOG_LABELS: Partial<Record<ScanOutcome, string>> = {
  validated: 'Étape validée',
  skipped: 'Étape sautée',
};
