/**
 * Carnet d'explorateur (docs/conception.md § 29) : les chasses finies d'un joueur, les villes
 * visitées, la distance parcourue et quelques badges. Volontairement sobre : pas de niveaux ni
 * de points, seulement des souvenirs et des repères.
 */
import { Hunt, RankingRow, Team } from './models.js';

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

/** Où en est une partie du joueur (historique). */
export type HistoryStatus = 'upcoming' | 'running' | 'finished' | 'treasure_skipped' | 'abandoned' | 'unfinished' | 'cancelled';

export const HISTORY_LABELS: Record<HistoryStatus, string> = {
  upcoming: 'À venir',
  running: 'En cours',
  finished: 'Terminée',
  treasure_skipped: 'Trésor abandonné',
  abandoned: 'Abandonnée',
  unfinished: 'Non terminée',
  cancelled: 'Annulée',
};

/** Une partie de l'historique : toutes les parties du joueur, finies ou non. */
export interface HistoryEntry {
  huntId: number;
  name: string;
  location: string;
  status: HistoryStatus;
  /** Départ de l'équipe ; à défaut, début prévu de la chasse. */
  date: string;
  /** Départ réel de l'équipe (pour le chrono d'une partie en cours). */
  started: string | null;
  /** Temps de parcours en secondes : pénalités comprises à l'arrivée ; jusqu'à l'abandon sinon. */
  time: number | null;
  /** Temps de référence en minutes : la durée annoncée, à défaut le meilleur temps de la partie. */
  referenceMinutes: number | null;
  referenceKind: 'announced' | 'best' | null;
  found: number;
  total: number;
  rank: number | null;
  teams: number;
  /** Note donnée par le joueur (1 à 5), null s'il n'a pas noté. */
  stars: number | null;
  /** Le joueur peut noter cette chasse maintenant (close, pas encore notée). */
  canRate: boolean;
}

/** Ce qu'il faut pour placer une partie dans l'historique (règle commune au serveur et à la maquette). */
export interface HistoryInput {
  hunt: Pick<Hunt, 'id' | 'name' | 'location' | 'status' | 'begin' | 'durationMinutes' | 'ownerId'>;
  team: Pick<Team, 'id' | 'started' | 'finished' | 'abandoned'>;
  ranking: RankingRow[];
  total: number;
  stars: number | null;
  me: number;
  now: number;
}

export function historyEntry({ hunt, team, ranking, total, stars, me, now }: HistoryInput): HistoryEntry {
  const row = ranking.find((r) => r.teamId === team.id);
  const closed = hunt.status === 'closed' || hunt.status === 'archived';
  const status: HistoryStatus = team.abandoned
    ? 'abandoned'
    : team.finished
      ? row?.treasureSkipped
        ? 'treasure_skipped'
        : 'finished'
      : hunt.status === 'cancelled'
        ? 'cancelled'
        : closed
          ? 'unfinished'
          : hunt.status === 'running' && team.started && Date.parse(team.started) <= now
            ? 'running'
            : 'upcoming';
  const time =
    team.finished && row?.time != null
      ? row.time
      : team.abandoned && team.started
        ? Math.max(0, (Date.parse(team.abandoned) - Date.parse(team.started)) / 1000)
        : null;
  const best = ranking.find((r) => r.rank === 1)?.time ?? null;
  const referenceMinutes = hunt.durationMinutes ?? (best !== null ? Math.round(best / 60) : null);
  return {
    huntId: hunt.id,
    name: hunt.name,
    location: hunt.location,
    status,
    date: team.started ?? hunt.begin,
    started: team.started,
    time,
    referenceMinutes,
    referenceKind: hunt.durationMinutes ? 'announced' : best !== null ? 'best' : null,
    found: row ? row.steps - row.skips : 0,
    total,
    rank: row?.rank ?? null,
    teams: ranking.length,
    stars,
    canRate: stars === null && closed && hunt.ownerId !== me,
  };
}

export interface ExplorerJournal {
  /** Toutes les parties du joueur, de la plus récente à la plus ancienne. */
  history: HistoryEntry[];
  hunts: JournalHunt[];
  cities: string[];
  totals: { hunts: number; steps: number; km: number };
  badges: Badge[];
}

const BADGES: { id: BadgeId; label: string; icon: string; hint: string; test: (hunts: JournalHunt[], cities: string[]) => boolean }[] = [
  { id: 'first', label: 'Premier trésor', icon: 'emoji_events', hint: 'Finir une Secret Track.', test: (h) => h.length >= 1 },
  { id: 'five', label: 'Chercheur aguerri', icon: 'explore', hint: 'Finir cinq Secret Tracks.', test: (h) => h.length >= 5 },
  { id: 'ten', label: 'Grand explorateur', icon: 'workspace_premium', hint: 'Finir dix Secret Tracks.', test: (h) => h.length >= 10 },
  { id: 'cities', label: 'Globe-trotteur', icon: 'travel_explore', hint: 'Jouer dans trois villes.', test: (_, c) => c.length >= 3 },
  { id: 'clean', label: 'Sans joker', icon: 'key_off', hint: 'Finir une Secret Track sans prendre de joker.', test: (h) => h.some((x) => x.hints === 0) },
  { id: 'solo', label: 'En autonomie', icon: 'hiking', hint: 'Finir une Secret Track du catalogue sans organisateur.', test: (h) => h.some((x) => x.autonomous) },
  { id: 'marathon', label: 'Marcheur', icon: 'directions_walk', hint: 'Parcourir 20 km de Secret Tracks au total.', test: (h) => h.reduce((a, x) => a + x.km, 0) >= 20 },
];

/** Ville d'une chasse : ce qui précède la première virgule de son lieu (« Montpellier, l'Écusson »), sans code postal. */
export function cityOf(location: string): string {
  return location.split(',')[0]!.trim().replace(/^\d{4,5}\s+/, '');
}

/** Le carnet, à partir des chasses finies et de l'historique (règle commune au serveur et à la maquette). */
export function explorerJournal(hunts: JournalHunt[], history: HistoryEntry[] = []): ExplorerJournal {
  const sorted = [...hunts].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const cities: string[] = [];
  for (const h of sorted) {
    const city = cityOf(h.location);
    if (city && !cities.some((c) => c.toLowerCase() === city.toLowerCase())) cities.push(city);
  }
  return {
    history: [...history].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
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
