/**
 * Créations de la communauté (docs/skins.md, conception § 19) : skins et packs d'énigmes
 * proposés par des créateurs, relus avant publication. Tout passe par un **manifeste
 * déclaratif contrôlé** : aucun code, aucun CSS libre, des URL sûres seulement.
 */
import { Puzzle, PUZZLE_TYPE_IDS, PuzzleType, puzzleProblem } from './puzzles.js';
import { safeSkinUrl, safeTokenValue, SKIN_TOKENS, SkinManifest, SkinSound, SkinSoundEvent, SkinToken } from './skins.js';

export type CreationKind = 'skin' | 'pack';
/** Brouillon → en relecture → publiée, ou refusée (avec la note du relecteur, à corriger). */
export type CreationStatus = 'draft' | 'review' | 'published' | 'rejected';

/** Contenu d'un skin de créateur : le manifeste sans identité (id, nom, auteur, prix viennent de la création). */
export type SkinContent = Pick<SkinManifest, 'scheme' | 'tokens' | 'fonts' | 'cover' | 'sounds' | 'effects'>;
/** Contenu d'un pack de créateur : des énigmes d'arrivée prêtes à poser. */
export interface PackContent {
  puzzles: Puzzle[];
}

export interface Creation {
  id: number;
  kind: CreationKind;
  authorId: number;
  authorNickname: string;
  name: string;
  description: string;
  /** Prix affiché, en centimes (0 à 20 €). */
  price: number;
  status: CreationStatus;
  /** Note du relecteur (refus, ou remarque à la publication). */
  note: string | null;
  /** Contenu complet : pour l'auteur et les relecteurs (un pack contient les réponses). */
  content: SkinContent | PackContent;
  /** Aperçu public : couverture d'un skin, nombre d'énigmes et types d'un pack. */
  cover: string | null;
  puzzleCount: number;
  published: string | null;
  lastUpdate: string;
  /** Pour l'auteur : ce qui empêche encore la publication (vide = publiable). */
  problems?: string[];
}

/** Ce que le créateur envoie : le contenu est contrôlé par le serveur. */
export interface CreationInput {
  kind: CreationKind;
  name: string;
  description: string;
  price: number;
  content: unknown;
}

/** Page publique d'un créateur. */
export interface CreatorPage {
  id: number;
  nickname: string;
  creations: Creation[];
}

/** Identifiant de produit d'une création publiée : « skin:u12 », « pack:u7 ». */
export function creationProductId(kind: CreationKind, id: number): string {
  return `${kind}:u${id}`;
}

/** Création désignée par un identifiant de produit ou de skin (« skin:u12 », « u12 »), ou null. */
export function creationRef(id: string): number | null {
  const m = /^(?:(?:skin|pack):)?u(\d{1,9})$/.exec(id);
  return m ? Number(m[1]) : null;
}

export const CREATION_LIMITS = { name: 40, description: 300, maxPrice: 2000, cover: 250_000, content: 400_000, puzzles: 40, fonts: 4, tones: 12 };

const HEX = /^#[0-9a-f]{3,8}$/i;
const SOUND_EVENTS: SkinSoundEvent[] = ['validate', 'hint', 'treasure'];

/**
 * Contrôle d'un skin proposé : ne garde que ce que le moteur de skins sait appliquer sans
 * risque, et dit pourquoi le reste est refusé. `problems` vide = publiable.
 */
export function checkSkinContent(input: unknown): { content: SkinContent; problems: string[] } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const tokens: Partial<Record<SkinToken, string>> = {};
  const rawTokens = src['tokens'] && typeof src['tokens'] === 'object' ? (src['tokens'] as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(rawTokens)) {
    if (!(SKIN_TOKENS as readonly string[]).includes(k)) problems.push(`Jeton inconnu : « ${k} ».`);
    else if (typeof v !== 'string' || !safeTokenValue(v)) problems.push(`Valeur refusée pour « ${k} » (CSS libre, URL non sûre ou trop longue).`);
    else tokens[k as SkinToken] = v;
  }
  if (!Object.keys(tokens).length) problems.push('Donnez au moins une couleur ou une police au skin.');

  const fonts: NonNullable<SkinContent['fonts']> = [];
  for (const f of Array.isArray(src['fonts']) ? src['fonts'].slice(0, CREATION_LIMITS.fonts + 1) : []) {
    const family = String(f?.family ?? '');
    const url = String(f?.url ?? '');
    if (!/^[\w -]{1,60}$/.test(family) || !(url.startsWith('https://') || url.startsWith('data:font/woff2')) || !safeSkinUrl(url)) {
      problems.push(`Police refusée : « ${family || 'sans nom'} » (nom simple, fichier woff2 en https).`);
      continue;
    }
    fonts.push({ family, url, ...(/^[1-9]00$/.test(String(f.weight)) ? { weight: String(f.weight) } : {}), ...(f.style === 'italic' ? { style: 'italic' as const } : {}) });
  }
  if (fonts.length > CREATION_LIMITS.fonts) problems.push(`Au plus ${CREATION_LIMITS.fonts} polices.`);

  const cover = typeof src['cover'] === 'string' ? src['cover'] : '';
  if (!cover || !(cover.startsWith('https://') || cover.startsWith('data:image/')) || !safeSkinUrl(cover)) problems.push('Ajoutez une image de couverture (https, ou image importée).');
  else if (cover.length > CREATION_LIMITS.cover) problems.push('Image de couverture trop lourde (250 Ko au plus).');

  const sounds: NonNullable<SkinContent['sounds']> = {};
  const rawSounds = src['sounds'] && typeof src['sounds'] === 'object' ? (src['sounds'] as Record<string, unknown>) : {};
  for (const [event, s] of Object.entries(rawSounds)) {
    if (!SOUND_EVENTS.includes(event as SkinSoundEvent)) continue;
    const sound = checkSound(s);
    if (sound) sounds[event as SkinSoundEvent] = sound;
    else problems.push(`Son refusé pour « ${event} » (URL sûre, ou au plus ${CREATION_LIMITS.tones} notes).`);
  }

  const e = (src['effects'] && typeof src['effects'] === 'object' ? src['effects'] : {}) as Record<string, unknown>;
  const effects: NonNullable<SkinContent['effects']> = {
    validate: e['validate'] === 'stamp' || e['validate'] === 'pulse' ? e['validate'] : 'none',
    treasure: e['treasure'] === 'confetti' ? 'confetti' : 'none',
    ...(Array.isArray(e['confetti']) ? { confetti: e['confetti'].filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 8) } : {}),
  };

  const content: SkinContent = { scheme: src['scheme'] === 'dark' ? 'dark' : 'light', tokens, fonts, cover, sounds, effects };
  if (JSON.stringify(content).length > CREATION_LIMITS.content) problems.push('Skin trop volumineux (400 Ko au plus).');
  return { content, problems };
}

function checkSound(s: unknown): SkinSound | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  if (typeof o['url'] === 'string') return safeSkinUrl(o['url']) && (o['url'].startsWith('https://') || o['url'].startsWith('data:audio/')) ? { url: o['url'] } : null;
  if (!Array.isArray(o['tones']) || !o['tones'].length || o['tones'].length > CREATION_LIMITS.tones) return null;
  const tones = o['tones'].map((t) => (Array.isArray(t) ? [Number(t[0]), Number(t[1])] : [NaN, NaN]) as [number, number]);
  if (!tones.every(([f, d]) => f >= 0 && f <= 4000 && d >= 10 && d <= 1500)) return null;
  const wave = ['sine', 'square', 'triangle', 'sawtooth'].includes(String(o['wave'])) ? (o['wave'] as 'sine') : 'sine';
  return { tones, wave };
}

/**
 * Contrôle d'un pack proposé : des énigmes jouables, d'un type connu. `content` garde aussi
 * les énigmes à corriger (brouillon) ; `problems` vide = publiable.
 */
export function checkPackContent(input: unknown): { content: PackContent; problems: string[] } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const list = Array.isArray(src['puzzles']) ? src['puzzles'] : [];
  const problems: string[] = [];
  const puzzles: Puzzle[] = [];
  list.slice(0, CREATION_LIMITS.puzzles).forEach((p, i) => {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const type = String(o['type']) as PuzzleType;
    if (!PUZZLE_TYPE_IDS.includes(type)) {
      problems.push(`Énigme ${i + 1} : type inconnu.`);
      return;
    }
    const puzzle: Puzzle = {
      type,
      prompt: String(o['prompt'] ?? '').trim().slice(0, 1000),
      answer: String(o['answer'] ?? '').trim().slice(0, 200),
      hint: String(o['hint'] ?? '').trim().slice(0, 500) || null,
      ...(type === 'cipher' ? { shift: Number(o['shift']) } : {}),
    };
    const problem = puzzleProblem(puzzle);
    if (problem) problems.push(`Énigme ${i + 1} : ${problem}`);
    puzzles.push(puzzle);
  });
  if (list.length > CREATION_LIMITS.puzzles) problems.push(`Au plus ${CREATION_LIMITS.puzzles} énigmes par pack.`);
  if (puzzles.length < 3) problems.push('Un pack compte au moins 3 énigmes.');
  return { content: { puzzles }, problems };
}

/** Le manifeste de skin qu'applique l'application pour une création publiée. */
export function creatorSkin(c: Pick<Creation, 'id' | 'name' | 'description' | 'authorNickname' | 'price'>, content: SkinContent): SkinManifest {
  return { id: `u${c.id}`, name: c.name, description: c.description, author: c.authorNickname, price: c.price, ...content };
}

/**
 * Même énigme qu'une énigme de pack : type, consigne, réponse et décalage identiques (l'indice
 * peut être retouché). Ce qu'un organisateur pose depuis un pack de créateur obtenu.
 */
export function samePuzzle(a: Puzzle, b: Puzzle): boolean {
  return a.type === b.type && a.prompt.trim() === b.prompt.trim() && a.answer.trim() === b.answer.trim() && (a.type !== 'cipher' || (a.shift ?? 3) === (b.shift ?? 3));
}
