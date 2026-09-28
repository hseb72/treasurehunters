/**
 * Repères pratiques d'une chasse du catalogue (docs/conception.md § 26) : ce que l'auteur
 * coche à la publication pour que les familles sachent à quoi s'attendre sur le parcours.
 */
export type PracticalTag = 'stroller' | 'wheelchair' | 'toilets' | 'cafe';

export const PRACTICAL_TAGS: { id: PracticalTag; label: string; icon: string; hint: string }[] = [
  { id: 'stroller', label: 'Poussette', icon: 'stroller', hint: 'Tout le parcours se fait avec une poussette.' },
  { id: 'wheelchair', label: 'Fauteuil roulant', icon: 'accessible', hint: 'Sans marches ni passages trop étroits.' },
  { id: 'toilets', label: 'Toilettes', icon: 'wc', hint: 'Des toilettes publiques sur le parcours.' },
  { id: 'cafe', label: 'Café, pause', icon: 'local_cafe', hint: 'Un café ou un endroit pour se poser en route.' },
];

export const PRACTICAL_IDS = PRACTICAL_TAGS.map((t) => t.id) as [PracticalTag, ...PracticalTag[]];

/** Âges conseillés proposés à l'auteur (null : tous âges). */
export const MIN_AGES = [4, 6, 8, 10, 12, 16] as const;

export function practicalTag(id: PracticalTag) {
  return PRACTICAL_TAGS.find((t) => t.id === id)!;
}

export function ageLabel(minAge: number | null): string {
  return minAge ? `Dès ${minAge} ans` : 'Tous âges';
}

/** Pour qui (§ 36) : les publics auxquels l'auteur destine sa chasse, pour le filtre « Avec qui ». */
export type AudienceTag = 'family' | 'couple' | 'friends' | 'solo' | 'group';

export const AUDIENCE_TAGS: { id: AudienceTag; label: string; icon: string }[] = [
  { id: 'family', label: 'En famille', icon: 'family_restroom' },
  { id: 'couple', label: 'En couple', icon: 'favorite' },
  { id: 'friends', label: 'Entre amis', icon: 'groups' },
  { id: 'solo', label: 'Seul', icon: 'person' },
  { id: 'group', label: 'Grand groupe', icon: 'diversity_3' },
];

export const AUDIENCE_IDS = AUDIENCE_TAGS.map((t) => t.id) as [AudienceTag, ...AudienceTag[]];

/** Où se joue le parcours : dehors, à l'intérieur (musée, château…), ou les deux. */
export type Setting = 'outdoor' | 'indoor' | 'mixed';

export const SETTINGS: { id: Setting; label: string; icon: string }[] = [
  { id: 'outdoor', label: 'En extérieur', icon: 'park' },
  { id: 'indoor', label: 'En intérieur', icon: 'museum' },
  { id: 'mixed', label: 'Intérieur et extérieur', icon: 'holiday_village' },
];

export const SETTING_IDS = SETTINGS.map((s) => s.id) as [Setting, ...Setting[]];
