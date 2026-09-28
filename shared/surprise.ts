/**
 * « Surprends-moi » (docs/conception.md § 37) : parmi les Secret Tracks jouables en autonomie
 * près du joueur, en choisir une qui tient dans son temps, qu'il n'a pas encore jouée, qui
 * ressemble à ce qu'il aime, avec un peu de hasard pour ne pas tomber toujours sur la même.
 * Calcul commun au serveur et à la maquette.
 */
import { minutesLabel } from './generation.js';
import type { CatalogEntry, Travel } from './models.js';
import { MEASURED_MIN } from './rules.js';

export interface SurpriseQuery {
  near?: { lat: number; lng: number };
  /** Rayon autour de `near`, en km (SURPRISE_RADIUS par défaut). */
  radius?: number;
  /** Temps dont le joueur dispose, en minutes. */
  minutes?: number;
  /** Versions déjà proposées, pour « Une autre ». */
  exclude?: number[];
}

export interface Surprise {
  entry: CatalogEntry | null;
  /** Pourquoi celle-ci : « à 1,2 km », « 1 h 24 en moyenne, dans votre temps »… */
  reasons: string[];
}

export const SURPRISE_RADIUS = 20;
/** Marge accordée sur le temps disponible, en minutes. */
const SLACK = 15;
/** Tirage parmi les meilleures candidates. */
const TOP = 5;

/** Durée la plus fiable : constatée à partir de MEASURED_MIN équipes arrivées, sinon prévue. */
export function expectedMinutes(e: Pick<CatalogEntry, 'durationMinutes' | 'measuredMinutes' | 'finishers'>): number {
  return e.measuredMinutes !== null && e.finishers >= MEASURED_MIN ? e.measuredMinutes : e.durationMinutes;
}

export function pickSurprise(
  candidates: CatalogEntry[],
  ctx: { played: Set<number>; usualTravel: Travel | null; minutes?: number; exclude?: number[]; random?: () => number },
): Surprise {
  const exclude = new Set(ctx.exclude ?? []);
  const fits = candidates.filter(
    (e) =>
      e.validation === 'geo' &&
      !e.withdrawn &&
      !ctx.played.has(e.id) &&
      !exclude.has(e.id) &&
      (!ctx.minutes || expectedMinutes(e) <= ctx.minutes + SLACK),
  );
  const score = (e: CatalogEntry) =>
    (e.rating.stars ?? 3.5) + (ctx.usualTravel && e.travel === ctx.usualTravel ? 0.5 : 0) - (e.distanceKm ?? 0) / 10;
  const top = fits.sort((a, b) => score(b) - score(a) || b.id - a.id).slice(0, TOP);
  if (!top.length) return { entry: null, reasons: [] };
  const entry = top[Math.floor((ctx.random ?? Math.random)() * top.length)]!;
  const reasons: string[] = [];
  if (entry.distanceKm !== null) reasons.push(`Départ à ${entry.distanceKm.toLocaleString('fr-FR')} km`);
  const expected = expectedMinutes(entry);
  reasons.push(ctx.minutes ? `${minutesLabel(expected)}, dans votre temps` : `Environ ${minutesLabel(expected)}`);
  if (entry.rating.stars !== null && entry.rating.count) reasons.push(`Notée ${(Math.round(entry.rating.stars * 10) / 10).toLocaleString('fr-FR')}/5`);
  if (ctx.usualTravel && entry.travel === ctx.usualTravel) reasons.push('Comme celles que vous aimez');
  if (ctx.played.size) reasons.push('Pas encore jouée');
  return { entry, reasons };
}
