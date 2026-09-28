/**
 * Détection des étapes problématiques (docs/conception.md § 43) : à partir des statistiques par
 * étape (§ 22), des signalements (§ 22) et de la fiabilité GPS (§ 42), dire à l'auteur quelles
 * étapes semblent poser problème, et pourquoi. Calcul commun au serveur et à la maquette.
 *
 * Joueurs → données → diagnostic → IA → amélioration → nouvelle version.
 */
import type { HuntStats } from './models.js';
import type { StepReliability } from './gps.js';

/** Équipes nécessaires avant de juger une étape. */
export const DIAGNOSIS_MIN_TEAMS = 3;

export interface StepDiagnosis {
  order: number;
  title: string;
  /** « 38 % des équipes prennent un joker », « temps moyen 9 min contre 3 min prévues »… */
  signals: string[];
  /** alert : plusieurs signaux, ou des équipes bloquées. */
  severity: 'warn' | 'alert';
}

const pct = (n: number, d: number) => Math.round((n / d) * 100);

export function diagnoseSteps(
  stats: HuntStats,
  opts: { durationMinutes?: number | null; reports?: Map<number, number>; gps?: StepReliability[] } = {},
): StepDiagnosis[] {
  const count = stats.steps.length;
  // Temps prévu par étape : la durée annoncée répartie sur les étapes.
  const expected = opts.durationMinutes && count ? opts.durationMinutes / count : null;
  const out: StepDiagnosis[] = [];
  for (const s of stats.steps) {
    const signals: string[] = [];
    if (s.teams >= DIAGNOSIS_MIN_TEAMS) {
      const hinted = s.hintTeams ?? Math.min(s.teams, s.hints);
      if (hinted / s.teams >= 0.35) signals.push(`${pct(hinted, s.teams)} % des équipes prennent un joker`);
      if (expected && s.avgMinutes !== null && s.avgMinutes >= 2 * expected && s.avgMinutes - expected >= 4) {
        signals.push(`temps moyen ${s.avgMinutes} min contre ${Math.max(1, Math.round(expected))} min prévues`);
      }
      if (s.skipped / s.teams >= 0.15) signals.push(`${pct(s.skipped, s.teams)} % abandonnent ici`);
      if (s.stuck / s.teams >= 0.15) signals.push(`${pct(s.stuck, s.teams)} % y sont restées bloquées`);
    }
    const reports = opts.reports?.get(s.order) ?? 0;
    if (reports >= 2) signals.push(`${reports} signalements ouverts`);
    const gps = opts.gps?.find((g) => g.order === s.order);
    if (gps?.unstable) signals.push(`GPS instable (${gps.reasons[0]})`);
    if (signals.length) out.push({ order: s.order, title: s.title, signals, severity: signals.length > 1 || s.stuck > 0 ? 'alert' : 'warn' });
  }
  return out;
}
