import { caesar, checkAnswer, normalizeAnswer, publicPuzzle, Puzzle, puzzleProblem, scramble } from './puzzles.js';

describe('énigmes d’arrivée', () => {
  it('compare les réponses sans accents, casse ni ponctuation, avec des variantes', () => {
    expect(normalizeAnswer('  L’Œuvre  d’Été ! ')).toBe('l oeuvre d ete');
    const q: Puzzle = { type: 'question', prompt: 'Année ?', answer: '1789|mille sept cent quatre-vingt-neuf' };
    expect(checkAnswer(q, ' 1789 ')).toBe(true);
    expect(checkAnswer(q, 'Mille sept cent quatre vingt neuf')).toBe(true);
    expect(checkAnswer(q, '1790')).toBe(false);
    expect(checkAnswer(q, '')).toBe(false);
    expect(checkAnswer({ type: 'lock', prompt: 'Code', answer: '0427' }, '0 4 2 7')).toBe(true);
  });

  it('chiffre par décalage et mélange de façon stable', () => {
    expect(caesar('Trésor caché', 3)).toBe('WUHVRU FDFKH');
    expect(caesar(caesar('Abc', 5), -5)).toBe('ABC');
    const a = scramble('boussole', 42);
    expect(a).toEqual(scramble('boussole', 42));
    expect(a.join('')).not.toBe('BOUSSOLE');
    expect([...a].sort()).toEqual([...'BOUSSOLE'].sort());
  });

  it('ne montre jamais la réponse aux joueurs', () => {
    const lock = publicPuzzle({ type: 'lock', prompt: 'Le code ?', answer: '1492', hint: 'Une date' }, 7);
    expect(lock).toEqual({ type: 'lock', prompt: 'Le code ?', hint: 'Une date', digits: 4 });
    const cipher = publicPuzzle({ type: 'cipher', prompt: 'Déchiffrez', answer: 'phare', shift: 1 }, 7);
    expect(cipher.cipher).toBe('QIBSF');
    expect(JSON.stringify(publicPuzzle({ type: 'anagram', prompt: '…', answer: 'fontaine' }, 3))).not.toContain('FONTAINE');
  });

  it('refuse une énigme mal rédigée', () => {
    expect(puzzleProblem({ type: 'lock', prompt: 'Code', answer: '12' })).toMatch(/3 à 6 chiffres/);
    expect(puzzleProblem({ type: 'lock', prompt: 'Code', answer: '123|1234' })).toMatch(/même nombre/);
    expect(puzzleProblem({ type: 'cipher', prompt: 'x', answer: 'mot' })).toMatch(/décalage/);
    expect(puzzleProblem({ type: 'question', prompt: ' ', answer: 'x' })).toMatch(/consigne/);
    expect(puzzleProblem({ type: 'anagram', prompt: 'x', answer: 'phare' })).toBeNull();
  });
});
