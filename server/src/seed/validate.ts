/**
 * Contrôle d'un parcours d'initialisation (§ 51) avant import : forme du fichier, puis ce qui
 * rendrait le parcours injouable — un lieu trop loin du précédent, une énigme qui nomme le lieu
 * qu'elle fait trouver, des jokers manquants.
 */
import { z } from 'zod';
import { AUDIENCE_IDS, PRACTICAL_IDS, SETTING_IDS } from '../../../shared/practical.js';
import { distanceMeters } from '../../../shared/rules.js';
import { SEED_KEY, SEED_MAX_LEG_KM, SEED_MAX_STEPS, SEED_MIN_STEPS, SeedHunt } from '../../../shared/seed.js';

const text = (max: number) => z.string().trim().min(1).max(max);

const stepSchema = z.object({
  title: text(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: text(200).optional(),
  arrival: text(600).optional(),
  riddle: text(600).optional(),
  hints: z.array(text(200)).optional(),
  photo: z
    .string()
    .regex(/^File:[^|#<>[\]{}]{1,240}$/)
    .optional(),
});

export const seedSchema = z.object({
  key: z.string().regex(SEED_KEY),
  name: text(80),
  location: text(120),
  summary: text(2000),
  startText: text(1000),
  travel: z.enum(['walk', 'active', 'motor']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  durationMinutes: z.number().int().min(20).max(480),
  audience: z.array(z.enum(AUDIENCE_IDS)),
  setting: z.enum(SETTING_IDS).nullable(),
  practical: z.array(z.enum(PRACTICAL_IDS)),
  minAge: z.number().int().min(2).max(18).nullable(),
  geoRadius: z.number().int().min(15).max(200).optional(),
  sampleOrder: z.number().int().min(0).optional(),
  steps: z.array(stepSchema).min(SEED_MIN_STEPS).max(SEED_MAX_STEPS),
});

/** Mots significatifs d'un nom de lieu (sans articles ni mots génériques). */
const GENERIC = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'l', 'd', 'et', 'en', 'au', 'aux', 'place', 'rue', 'parc', 'jardin', 'square', 'quai', 'pont', 'église', 'musée', 'fontaine', 'statue', 'porte', 'tour', 'saint', 'sainte']);
function significantWords(title: string): string[] {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !GENERIC.has(w));
}
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export interface SeedCheck {
  seed: SeedHunt | null;
  errors: string[];
}

export function checkSeed(raw: unknown): SeedCheck {
  const parsed = seedSchema.safeParse(raw);
  if (!parsed.success) return { seed: null, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(fichier)'} : ${i.message}`) };
  const seed = parsed.data as SeedHunt;
  const errors: string[] = [];
  const last = seed.steps.length - 1;
  seed.steps.forEach((s, i) => {
    const where = i === 0 ? 'départ' : i === last ? 'arrivée' : `étape ${i}`;
    if (i < last && !s.riddle) errors.push(`${where} (${s.title}) : il manque l'énigme qui mène au lieu suivant.`);
    if (i < last && s.hints?.length !== 3) errors.push(`${where} (${s.title}) : il faut exactement trois jokers.`);
    if (i === last && s.riddle) errors.push(`arrivée (${s.title}) : pas d'énigme après l'arrivée.`);
    if (i > 0 && !s.arrival) errors.push(`${where} (${s.title}) : il manque le message d'arrivée.`);
    if (i > 0) {
      const prev = seed.steps[i - 1]!;
      const km = distanceMeters(prev, s) / 1000;
      if (km > SEED_MAX_LEG_KM[seed.travel]) errors.push(`${where} (${s.title}) : ${km.toFixed(1)} km depuis le lieu précédent, trop loin pour « ${seed.travel} ».`);
      if (km < 0.03) errors.push(`${where} (${s.title}) : à moins de 30 m du lieu précédent.`);
      // Une énigme ne nomme jamais le lieu qu'elle fait trouver.
      const riddle = normalize(prev.riddle ?? '');
      const named = significantWords(s.title).filter((w) => new RegExp(`\\b${w}\\b`).test(riddle));
      if (named.length) errors.push(`${where} (${s.title}) : l'énigme qui y mène contient « ${named.join(', ')} ».`);
    }
  });
  const keys = new Set(seed.steps.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`));
  if (keys.size < seed.steps.length) errors.push('Deux lieux ont exactement la même position.');
  if (seed.sampleOrder !== undefined && seed.sampleOrder >= last) errors.push('sampleOrder : choisissez une énigme du parcours (avant l’arrivée).');
  return { seed, errors };
}
