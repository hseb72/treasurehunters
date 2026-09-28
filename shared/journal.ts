/**
 * Carnet d'explorateur (docs/conception.md § 29) : les chasses finies d'un joueur, les villes
 * visitées, la distance parcourue et quelques badges. Volontairement sobre : pas de niveaux ni
 * de points, seulement des souvenirs et des repères.
 */

export interface JournalHunt {
  huntId: number;
  name: string;
  location: string;
  skin: string;
  /** Départ de l'équipe. */
  date: string;
  /** Temps de parcours en secondes, pénalités comprises. */
  time: number;
  found: number;
  hints: number;
  /** Partie en autonomie d'une chasse du catalogue. */
  autonomous: boolean;
  catalogId: number | null;
  /** Distance à vol d'oiseau entre les lieux trouvés, en km. */
  km: number;
}

export type BadgeId = 'first' | 'five' | 'ten' | 'cities' | 'clean' | 'solo' | 'marathon';

export interface Badge {
  id: BadgeId;
  label: string;
  icon: string;
  /** Comment l'obtenir. */
  hint: string;
  earned: boolean;
}

export interface ExplorerJournal {
  hunts: JournalHunt[];
  cities: string[];
  totals: { hunts: number; steps: number; km: number };
  badges: Badge[];
}

const BADGES: { id: BadgeId; label: string; icon: string; hint: string; test: (hunts: JournalHunt[], cities: string[]) => boolean }[] = [
  { id: 'first', label: 'Premier trésor', icon: 'emoji_events', hint: 'Finir une chasse.', test: (h) => h.length >= 1 },
  { id: 'five', label: 'Chercheur aguerri', icon: 'explore', hint: 'Finir cinq chasses.', test: (h) => h.length >= 5 },
  { id: 'ten', label: 'Grand explorateur', icon: 'workspace_premium', hint: 'Finir dix chasses.', test: (h) => h.length >= 10 },
  { id: 'cities', label: 'Globe-trotteur', icon: 'travel_explore', hint: 'Jouer dans trois villes.', test: (_, c) => c.length >= 3 },
  { id: 'clean', label: 'Sans joker', icon: 'key_off', hint: 'Finir une chasse sans prendre de joker.', test: (h) => h.some((x) => x.hints === 0) },
  { id: 'solo', label: 'En autonomie', icon: 'hiking', hint: 'Finir une chasse du catalogue sans organisateur.', test: (h) => h.some((x) => x.autonomous) },
  { id: 'marathon', label: 'Marcheur', icon: 'directions_walk', hint: 'Parcourir 20 km de chasses au total.', test: (h) => h.reduce((a, x) => a + x.km, 0) >= 20 },
];

/** Ville d'une chasse : ce qui précède la première virgule de son lieu (« Montpellier, l'Écusson »), sans code postal. */
export function cityOf(location: string): string {
  return location.split(',')[0]!.trim().replace(/^\d{4,5}\s+/, '');
}

/** Le carnet, à partir des chasses finies (règle commune au serveur et à la maquette). */
export function explorerJournal(hunts: JournalHunt[]): ExplorerJournal {
  const sorted = [...hunts].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const cities: string[] = [];
  for (const h of sorted) {
    const city = cityOf(h.location);
    if (city && !cities.some((c) => c.toLowerCase() === city.toLowerCase())) cities.push(city);
  }
  return {
    hunts: sorted,
    cities,
    totals: {
      hunts: sorted.length,
      steps: sorted.reduce((a, h) => a + h.found, 0),
      km: Math.round(sorted.reduce((a, h) => a + h.km, 0) * 10) / 10,
    },
    badges: BADGES.map(({ test, ...b }) => ({ ...b, earned: test(sorted, cities) })),
  };
}
