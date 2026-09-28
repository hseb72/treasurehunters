/**
 * Statistiques par étape (docs/conception.md § 22), communes au serveur et à la maquette :
 * pour chaque étape k, les équipes qui ont reçu l'énigme qui y mène, qui l'ont trouvée ou
 * abandonnée, les jokers pris sur cette énigme, le temps moyen pour la trouver, et les équipes
 * restées bloquées (partie close sans l'avoir trouvée).
 */
import { HintUse, HuntStats, Team, Validation } from './models.js';

export interface PlayData {
  /** Partie close : une équipe qui n'a pas trouvé l'étape y est restée bloquée. */
  over: boolean;
  /** Ordre de chaque étape de la partie, par identifiant. */
  orderOf: Map<number, number>;
  teams: Team[];
  validations: Validation[];
  hints: HintUse[];
}

export function stepStats(plays: PlayData[], titles: Map<number, string>): HuntStats {
  const final = Math.max(0, ...titles.keys());
  const acc = new Map<number, { teams: number; found: number; skipped: number; hints: number; hintTeams: number; minutes: number[]; stuck: number }>();
  for (let k = 1; k <= final; k++) acc.set(k, { teams: 0, found: 0, skipped: 0, hints: 0, hintTeams: 0, minutes: [], stuck: 0 });
  let teams = 0;
  let finished = 0;
  for (const p of plays) {
    for (const team of p.teams) {
      if (!team.started) continue;
      teams++;
      if (team.finished) finished++;
      const mine = new Map(p.validations.filter((v) => v.teamId === team.id).map((v) => [p.orderOf.get(v.stepId)!, v]));
      let prev = Date.parse(team.started);
      for (let k = 1; k <= final; k++) {
        if (k > 1 && !mine.has(k - 1)) break;
        const a = acc.get(k)!;
        a.teams++;
        const taken = p.hints.filter((h) => h.teamId === team.id && p.orderOf.get(h.stepId) === k - 1).length;
        a.hints += taken;
        if (taken) a.hintTeams++;
        const v = mine.get(k);
        if (!v) {
          if (p.over) a.stuck++;
          break;
        }
        if (v.source === 'SKIP') a.skipped++;
        else {
          a.found++;
          a.minutes.push((Date.parse(v.at) - prev) / 60_000);
        }
        prev = Date.parse(v.at);
      }
    }
  }
  return {
    plays: plays.length,
    teams,
    finished,
    steps: [...acc.entries()].map(([k, a]) => ({
      order: k,
      title: titles.get(k) ?? `Étape ${k}`,
      teams: a.teams,
      found: a.found,
      skipped: a.skipped,
      hints: a.hints,
      hintTeams: a.hintTeams,
      avgMinutes: a.minutes.length ? Math.round(a.minutes.reduce((x, y) => x + y, 0) / a.minutes.length) : null,
      stuck: a.stuck,
    })),
  };
}
