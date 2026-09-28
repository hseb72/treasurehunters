/**
 * Rôles dans l'équipe (docs/conception.md § 41) : facultatifs, pour le plaisir du rallye.
 * Chacun choisit le sien ; le créateur de l'équipe peut les répartir. Un seul capitaine.
 */
export type TeamRole = 'captain' | 'navigator' | 'reader' | 'solver' | 'photographer';

export const TEAM_ROLES: { id: TeamRole; label: string; icon: string; task: string }[] = [
  { id: 'captain', label: 'Capitaine', icon: 'military_tech', task: 'tranche quand on hésite' },
  { id: 'navigator', label: 'Navigateur', icon: 'explore', task: 'navigation' },
  { id: 'reader', label: 'Lecteur', icon: 'record_voice_over', task: 'lit les énigmes' },
  { id: 'solver', label: 'Déchiffreur', icon: 'extension', task: 'énigmes' },
  { id: 'photographer', label: 'Photographe', icon: 'photo_camera', task: 'photos' },
];

export const TEAM_ROLE_IDS = TEAM_ROLES.map((r) => r.id) as [TeamRole, ...TeamRole[]];

export function teamRole(id: TeamRole | null | undefined) {
  return TEAM_ROLES.find((r) => r.id === id) ?? null;
}
