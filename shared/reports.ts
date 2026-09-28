/** Natures de problème qu'un joueur peut signaler sur une étape (§ 22). */
import type { ReportCategory } from './models.js';

export const REPORT_CATEGORIES: { id: ReportCategory; label: string; icon: string }[] = [
  { id: 'closed', label: 'Lieu fermé ou inaccessible', icon: 'block' },
  { id: 'works', label: 'Travaux, lieu transformé', icon: 'construction' },
  { id: 'qr', label: 'QR code absent ou abîmé', icon: 'qr_code_2' },
  { id: 'riddle', label: 'Énigme ou indice erroné', icon: 'psychology_alt' },
  { id: 'danger', label: 'Passage dangereux', icon: 'warning' },
  { id: 'other', label: 'Autre problème', icon: 'help' },
];

