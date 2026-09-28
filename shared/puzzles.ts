/**
 * Énigmes d'arrivée (docs/conception.md § 17) : une épreuve facultative posée sur une étape.
 * Arriver sur le lieu (QR, géolocalisation, photo) ne suffit plus : l'équipe valide l'étape en
 * résolvant l'énigme. Les types viennent de packs de la boutique ; la question sur place est incluse.
 */

export type PuzzleType = 'question' | 'lock' | 'cipher' | 'anagram' | 'rebus';

/** Énigme telle que l'organisateur la rédige (réponse comprise). */
export interface Puzzle {
  type: PuzzleType;
  /** Consigne lue par les joueurs (« Quel symbole est gravé sur la pierre ? »). */
  prompt: string;
  /** Réponse attendue ; plusieurs acceptées, séparées par « | » (« 1789|mille sept cent quatre-vingt-neuf »). */
  answer: string;
  /** Indice facultatif, que l'équipe peut afficher. */
  hint?: string | null;
  /** Message chiffré : décalage de l'alphabet (chiffre de César), de 1 à 25. */
  shift?: number;
}

/** Ce que voient les joueurs : jamais la réponse. */
export interface PublicPuzzle {
  type: PuzzleType;
  prompt: string;
  hint: string | null;
  /** Cadenas : nombre de chiffres du code. */
  digits?: number;
  /** Message chiffré : le texte à déchiffrer. */
  cipher?: string;
  /** Anagramme : les lettres mélangées. */
  letters?: string[];
}

export interface PuzzleTypeInfo {
  type: PuzzleType;
  name: string;
  description: string;
  icon: string;
  /** Pack de la boutique qui apporte ce type (« pack:codes »). */
  pack: string;
}

export const PUZZLE_TYPES: PuzzleTypeInfo[] = [
  { type: 'question', name: 'Question sur place', description: 'Une question dont la réponse se lit sur le lieu : une date gravée, un nom, un symbole.', icon: 'quiz', pack: 'pack:question' },
  { type: 'lock', name: 'Cadenas à code', description: 'Un cadenas à molettes : le code (3 à 6 chiffres) se déduit de ce qu’on observe.', icon: 'lock', pack: 'pack:codes' },
  { type: 'cipher', name: 'Message chiffré', description: 'Un message codé par décalage de l’alphabet, à déchiffrer avec la roue de César.', icon: 'key', pack: 'pack:codes' },
  { type: 'anagram', name: 'Anagramme', description: 'Des lettres mélangées à remettre dans l’ordre.', icon: 'abc', pack: 'pack:lettres' },
  { type: 'rebus', name: 'Rébus', description: 'Des images et des syllabes (émojis permis) à assembler en un mot ou une phrase.', icon: 'emoji_objects', pack: 'pack:lettres' },
];

export const PUZZLE_TYPE_IDS = PUZZLE_TYPES.map((p) => p.type) as [PuzzleType, ...PuzzleType[]];

export function puzzleType(type: PuzzleType): PuzzleTypeInfo {
  return PUZZLE_TYPES.find((p) => p.type === type)!;
}

/** Forme comparable d'une réponse : minuscules, sans accents, sans ponctuation ni espaces superflus. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Réponses acceptées, sous forme comparable. */
function accepted(p: Puzzle): string[] {
  return p.answer
    .split('|')
    .map((a) => (p.type === 'lock' ? a.replace(/\D/g, '') : normalizeAnswer(a)))
    .filter(Boolean);
}

export function checkAnswer(p: Puzzle, given: string): boolean {
  const value = p.type === 'lock' ? given.replace(/\D/g, '') : normalizeAnswer(given);
  return !!value && accepted(p).includes(value);
}

/** Chiffre de César : décale les lettres (accents retirés), garde le reste. */
export function caesar(text: string, shift: number): string {
  const k = ((shift % 26) + 26) % 26;
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + k) % 26) + 65));
}

/** Mélange déterministe (même ordre à chaque affichage, jamais l'ordre d'origine si c'est possible). */
export function scramble(word: string, seed: number): string[] {
  const letters = [...normalizeAnswer(word).replace(/ /g, '').toUpperCase()];
  let s = (seed * 9301 + 49297) % 233280 || 1;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let tries = 0; tries < 5; tries++) {
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    if (letters.join('') !== normalizeAnswer(word).replace(/ /g, '').toUpperCase()) break;
  }
  return letters;
}

/** Vue joueur d'une énigme. `seed` : l'identifiant de l'étape, pour un mélange stable. */
export function publicPuzzle(p: Puzzle, seed: number): PublicPuzzle {
  const first = p.answer.split('|')[0];
  const base: PublicPuzzle = { type: p.type, prompt: p.prompt, hint: p.hint?.trim() || null };
  switch (p.type) {
    case 'lock':
      return { ...base, digits: first.replace(/\D/g, '').length };
    case 'cipher':
      return { ...base, cipher: caesar(first, p.shift ?? 3) };
    case 'anagram':
      return { ...base, letters: scramble(first, seed) };
    default:
      return base;
  }
}

/** Erreur de rédaction, ou null si l'énigme est jouable. */
export function puzzleProblem(p: Puzzle): string | null {
  if (!p.prompt.trim()) return 'Rédigez la consigne de l’énigme.';
  const answers = p.answer.split('|').map((a) => a.trim()).filter(Boolean);
  if (!answers.length) return 'Indiquez la réponse attendue.';
  if (p.type === 'lock' && !answers.every((a) => /^\d{3,6}$/.test(a))) return 'Le code d’un cadenas compte de 3 à 6 chiffres.';
  if (p.type === 'lock' && new Set(answers.map((a) => a.length)).size > 1) return 'Les codes acceptés doivent avoir le même nombre de chiffres.';
  if (p.type === 'cipher' && !/[a-z]/i.test(answers[0])) return 'Le message à chiffrer doit contenir des lettres.';
  if (p.type === 'cipher' && !(Number.isInteger(p.shift) && p.shift! >= 1 && p.shift! <= 25)) return 'Le décalage du message chiffré va de 1 à 25.';
  if (p.type === 'anagram' && normalizeAnswer(answers[0]).replace(/ /g, '').length < 3) return 'Une anagramme compte au moins 3 lettres.';
  if (p.type === 'anagram' && normalizeAnswer(answers[0]).replace(/ /g, '').length > 16) return 'Une anagramme compte au plus 16 lettres.';
  return null;
}
