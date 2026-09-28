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
