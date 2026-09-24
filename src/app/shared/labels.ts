import { HuntStatus, ScanOutcome, StartMode } from '@shared/models';

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

/** « +2 min pour le joker 1, +5 min pour le 2, +10 min pour le 3 » ; chaîne vide sans pénalité. */
export function penaltyText(penalties: number[]): string {
  if (!penalties.some((p) => p > 0)) return '';
  if (penalties.every((p) => p === penalties[0])) return `+${penalties[0]} min par joker`;
  return penalties.map((p, i) => (i === 0 ? `+${p} min pour le joker 1` : `+${p} min pour le ${i + 1}`)).join(', ');
}

export const SCAN_LOG_LABELS: Partial<Record<ScanOutcome, string>> = {
  validated: 'Étape validée',
  skipped: 'Étape sautée',
};
