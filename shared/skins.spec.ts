import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN, safeSkinUrl, safeTokenValue, SKIN_TOKENS, SKINS, skinById, skinStyle } from './skins.js';

describe('skins', () => {
  it('n’accepte que des valeurs qui restent dans leur déclaration CSS', () => {
    expect(safeTokenValue('#13294b')).toBe(true);
    expect(safeTokenValue("'Cinzel', Georgia, serif")).toBe(true);
    expect(safeTokenValue('linear-gradient(135deg, #1c2a5e, #0b1026 70%)')).toBe(true);
    expect(safeTokenValue('red; background: url(https://x.fr/a.png)')).toBe(false);
    expect(safeTokenValue('red } body { display: none')).toBe(false);
    expect(safeTokenValue('expression(alert(1))')).toBe(false);
    expect(safeTokenValue('url(javascript:alert(1))')).toBe(false);
    expect(safeTokenValue('url(http://tracker.example/pixel.png)')).toBe(false); // pas de http en clair
    expect(safeTokenValue('url("https://cdn.example/fond.webp")')).toBe(true);
    expect(safeTokenValue(`url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg'/>")}")`)).toBe(true);
  });

  it('ne charge que des fichiers https ou des images, polices et sons intégrés', () => {
    expect(safeSkinUrl('https://cdn.example/son.mp3')).toBe(true);
    expect(safeSkinUrl('data:audio/mpeg;base64,AAAA')).toBe(true);
    expect(safeSkinUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(safeSkinUrl('http://cdn.example/son.mp3')).toBe(false);
  });

  it('ignore les jetons inconnus ou douteux d’un skin tiers', () => {
    const style = skinStyle({ ...SKINS[0], tokens: { ink: '#000', 'font-body': 'x; color: red', ['position' as never]: 'fixed' } });
    expect(style).toEqual({ '--th-ink': '#000' });
  });

  it('livre des skins intégrés entièrement valides', () => {
    for (const skin of SKINS) {
      expect(Object.keys(skinStyle(skin))).toHaveLength(Object.keys(skin.tokens).length);
      expect(Object.keys(skin.tokens).every((t) => (SKIN_TOKENS as readonly string[]).includes(t))).toBe(true);
      expect(safeSkinUrl(skin.cover)).toBe(true);
    }
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    expect(skinById('inconnu').id).toBe(DEFAULT_SKIN);
  });
});
