import { sketchTrail } from './souvenir.js';

describe('sketchTrail', () => {
  it('ramène le parcours dans le carré unité, centré, proportions gardées', () => {
    const t = sketchTrail([
      { lat: 43.6, lng: 3.87 },
      { lat: 43.6, lng: 3.89 },
      { lat: 43.61, lng: 3.89 },
    ]);
    expect(t).toHaveLength(3);
    for (const [x, y] of t) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    // Plus large que haut : toute la largeur, et le nord en haut.
    expect(t[0]![0]).toBe(0);
    expect(t[1]![0]).toBe(1);
    expect(t[2]![1]).toBeLessThan(t[1]![1]);
  });

  it('gère un parcours vide ou réduit à un point', () => {
    expect(sketchTrail([])).toEqual([]);
    expect(sketchTrail([{ lat: 1, lng: 2 }, { lat: 1, lng: 2 }])).toEqual([[0.5, 0.5], [0.5, 0.5]]);
  });
});
