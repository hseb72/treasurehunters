import { checkPackContent, checkSkinContent, creationRef, samePuzzle } from './creations.js';
import { SKINS } from './skins.js';

describe('contrôle des créations', () => {
  it('accepte un univers intégré tel quel', () => {
    // L'univers épuré n'a aucun jeton : c'est le thème de base.
    for (const s of SKINS.filter((x) => Object.keys(x.tokens).length)) {
      const { problems } = checkSkinContent({ scheme: s.scheme, tokens: s.tokens, fonts: s.fonts, cover: s.cover, sounds: s.sounds, effects: s.effects });
      expect([s.id, problems]).toEqual([s.id, []]);
    }
  });

  it('retire le CSS libre, les URL non sûres et les jetons inconnus', () => {
    const { content, problems } = checkSkinContent({
      tokens: { ink: '#123', accent: 'red; } * { display: none', texture: 'url("http://pistage.example/x.png")', 'page-bg': 'url(data:text/html,<script>)', nope: '1px' },
      fonts: [{ family: 'Evil"; }', url: 'https://x/y.woff2' }, { family: 'Ok', url: 'http://x/y.woff2' }],
      cover: 'javascript:alert(1)',
      sounds: { validate: { tones: Array(20).fill([440, 50]) }, treasure: { url: 'https://cdn.example/fanfare.mp3' } },
    });
    expect(content.tokens).toEqual({ ink: '#123' });
    expect(content.fonts).toEqual([]);
    expect(content.sounds).toEqual({ treasure: { url: 'https://cdn.example/fanfare.mp3' } });
    expect(problems.length).toBe(8);
  });

  it('garde les énigmes à corriger d’un pack, sans le déclarer publiable', () => {
    const { content, problems } = checkPackContent({ puzzles: [{ type: 'lock', prompt: 'Code', answer: '12' }, { type: 'magie', prompt: 'x', answer: 'y' }] });
    expect(content.puzzles).toHaveLength(1);
    expect(problems).toEqual(['Énigme 1 : Le code d’un cadenas compte de 3 à 6 chiffres.', 'Énigme 2 : type inconnu.', 'Un pack compte au moins 3 énigmes.']);
  });

  it('reconnaît les identifiants et les énigmes tirées d’un pack', () => {
    expect([creationRef('skin:u12'), creationRef('u7'), creationRef('skin:medieval'), creationRef('u')]).toEqual([12, 7, null, null]);
    const p = { type: 'cipher' as const, prompt: 'Déchiffrez.', answer: 'terre', hint: 'a', shift: 4 };
    expect(samePuzzle(p, { ...p, hint: 'autre' })).toBe(true);
    expect(samePuzzle(p, { ...p, shift: 5 })).toBe(false);
  });
});
