/**
 * Contrôle d'un parcours d'initialisation (§ 51) avant import : forme du fichier, puis ce qui
 * rendrait le parcours injouable — un lieu trop loin du précédent, une énigme qui nomme le lieu
 * qu'elle fait trouver, des jokers manquants, une épreuve d'arrivée mal rédigée.
 */
import { z } from 'zod';
import { AUDIENCE_IDS, PRACTICAL_IDS, SETTING_IDS } from '../../../shared/practical.js';
import { distanceMeters } from '../../../shared/rules.js';
import { PUZZLE_TYPE_IDS, puzzleProblem } from '../../../shared/puzzles.js';
import { HUNT_FILE_FORMAT, HuntFile, SEED_KEY, SEED_MAX_LEG_KM, SEED_MAX_STEPS, SEED_MIN_STEPS, SeedHunt } from '../../../shared/seed.js';

const text = (max: number) => z.string().trim().min(1).max(max);

/** Épreuve d'arrivée (§ 17) : les longueurs de l'éditeur. */
const puzzleSchema = z.object({
  type: z.enum(PUZZLE_TYPE_IDS),
  prompt: text(1000),
  answer: text(200),
  hint: z.string().trim().max(500).nullable().optional(),
  shift: z.number().int().min(1).max(25).optional(),
});

const stepSchema = z.object({
  title: text(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: text(200).optional(),
  arrival: text(600).optional(),
  riddle: text(600).optional(),
  hints: z.array(text(200)).optional(),
  puzzle: puzzleSchema.optional(),
  photo: z
    .string()
    .regex(/^File:[^|#<>[\]{}]{1,240}$/)
    .optional(),
});

export const seedSchema = z.object({
  key: z.string().regex(SEED_KEY),
  name: text(50), // comme une chasse (th_hunts.hun_name, varchar(50))
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

/** Ce qui rendrait un parcours injouable ou décevant : énigmes, jokers, arrivées, distances, lieu nommé. */
export function playabilityProblems(steps: { title: string; lat: number | null; lng: number | null; arrival?: string | null; riddle?: string | null; hints?: string[] }[], travel: SeedHunt['travel']): string[] {
  const errors: string[] = [];
  const last = steps.length - 1;
  steps.forEach((s, i) => {
    const where = i === 0 ? 'départ' : i === last ? 'arrivée' : `étape ${i}`;
    if (i < last && !s.riddle) errors.push(`${where} (${s.title}) : il manque l'énigme qui mène au lieu suivant.`);
    if (i < last && s.hints?.length !== 3) errors.push(`${where} (${s.title}) : il faut exactement trois jokers.`);
    if (i === last && s.riddle) errors.push(`arrivée (${s.title}) : pas d'énigme après l'arrivée.`);
    if (i > 0 && !s.arrival) errors.push(`${where} (${s.title}) : il manque le message d'arrivée.`);
    if (i > 0) {
      const prev = steps[i - 1]!;
      if (prev.lat !== null && prev.lng !== null && s.lat !== null && s.lng !== null) {
        const km = distanceMeters({ lat: prev.lat, lng: prev.lng }, { lat: s.lat, lng: s.lng }) / 1000;
        if (km > SEED_MAX_LEG_KM[travel]) errors.push(`${where} (${s.title}) : ${km.toFixed(1)} km depuis le lieu précédent, trop loin pour « ${travel} ».`);
        if (km < 0.03) errors.push(`${where} (${s.title}) : à moins de 30 m du lieu précédent.`);
      }
      // Une énigme ne nomme jamais le lieu qu'elle fait trouver.
      const riddle = normalize(prev.riddle ?? '');
      const named = significantWords(s.title).filter((w) => new RegExp(`\\b${w}\\b`).test(riddle));
      if (named.length) errors.push(`${where} (${s.title}) : l'énigme qui y mène contient « ${named.join(', ')} ».`);
    }
  });
  const placed = steps.filter((s) => s.lat !== null && s.lng !== null);
  const keys = new Set(placed.map((s) => `${s.lat!.toFixed(5)},${s.lng!.toFixed(5)}`));
  if (keys.size < placed.length) errors.push('Deux lieux ont exactement la même position.');
  return errors;
}

export function checkSeed(raw: unknown): SeedCheck {
  const parsed = seedSchema.safeParse(raw);
  if (!parsed.success) return { seed: null, errors: issues(parsed.error) };
  const seed = parsed.data as SeedHunt;
  const errors = playabilityProblems(seed.steps, seed.travel);
  if (seed.sampleOrder !== undefined && seed.sampleOrder >= seed.steps.length - 1) errors.push('sampleOrder : choisissez une énigme du parcours (avant l’arrivée).');
  // Épreuves d'arrivée : jamais au départ, rédigées comme dans l'éditeur.
  seed.steps.forEach((s, i) => {
    if (!s.puzzle) return;
    if (i === 0) errors.push(`départ (${s.title}) : pas d'épreuve d'arrivée au départ.`);
    const problem = puzzleProblem(s.puzzle);
    if (problem) errors.push(`${s.title} : épreuve — ${problem}`);
  });
  return { seed, errors };
}

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || '(fichier)'} : ${i.message}`);

const longText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

/** Fichier d'export d'une chasse (§ 52) : les longueurs de l'éditeur, positions facultatives. */
export const huntFileSchema = z.object({
  format: z.literal(HUNT_FILE_FORMAT),
  name: text(255),
  location: z.string().trim().max(255),
  summary: z.string().trim().max(5000),
  startText: z.string().trim().max(5000),
  travel: z.enum(['walk', 'active', 'motor']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  durationMinutes: z.number().int().min(10).max(1440),
  steps: z
    .array(
      z.object({
        title: text(255),
        lat: z.number().min(-90).max(90).nullable(),
        lng: z.number().min(-180).max(180).nullable(),
        address: longText(255),
        arrival: longText(5000),
        riddle: longText(5000),
        hints: z.array(text(2000)).max(3).optional().default([]),
        puzzle: puzzleSchema
          .nullable()
          .optional()
          .default(null),
        photo: z
          .string()
          .regex(/^File:[^|#<>[\]{}]{1,240}$/)
          .nullable()
          .optional()
          .default(null),
      }),
    )
    .min(2)
    .max(60),
});

export interface HuntFileCheck {
  file: HuntFile | null;
  /** Fichier illisible : rien n'est importé. */
  errors: string[];
  /** À relire, sans empêcher l'import. */
  warnings: string[];
}

export function checkHuntFile(raw: unknown): HuntFileCheck {
  const parsed = huntFileSchema.safeParse(raw);
  if (!parsed.success) return { file: null, errors: issues(parsed.error).slice(0, 20), warnings: [] };
  const file = parsed.data as HuntFile;
  const warnings = playabilityProblems(file.steps, file.travel);
  file.steps.forEach((s, i) => {
    if (s.lat === null || s.lng === null) warnings.push(`${i === 0 ? 'départ' : `étape ${i}`} (${s.title}) : pas de position, à placer sur la carte.`);
    if (i === 0 && s.puzzle) warnings.push(`départ (${s.title}) : pas d'épreuve d'arrivée au départ, elle est ignorée.`);
  });
  if (file.steps[0]?.puzzle) file.steps[0].puzzle = null;
  return { file, errors: [], warnings };
}
