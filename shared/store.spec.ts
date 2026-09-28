import { bearingDegrees, compassReading, owns, PRODUCTS, priceLabel } from './store.js';

describe('boutique', () => {
  it('distingue le cap des quatre points cardinaux', () => {
    const o = { lat: 43.6, lng: 3.88 };
    expect(Math.round(bearingDegrees(o, { lat: 43.61, lng: 3.88 }))).toBe(0);
    expect(Math.round(bearingDegrees(o, { lat: 43.6, lng: 3.9 }))).toBe(90);
    expect(Math.round(bearingDegrees(o, { lat: 43.59, lng: 3.88 }))).toBe(180);
    expect(Math.round(bearingDegrees(o, { lat: 43.6, lng: 3.86 }))).toBe(270);
  });

  it('arrondit la boussole à huit directions et à une fourchette de distance', () => {
    const o = { lat: 43.6, lng: 3.88 };
    expect(compassReading(o, { lat: 43.601, lng: 3.8813 }, 120)).toEqual({ bearing: 45, direction: 'le nord-est', band: 'entre 50 et 150 m' });
    expect(compassReading(o, { lat: 43.59, lng: 3.88 }, 20).band).toBe('tout près, à moins de 50 m');
    expect(compassReading(o, { lat: 43.6, lng: 3.8 }, 6500)).toMatchObject({ bearing: 270, direction: 'l’ouest', band: 'à plus de 3 km' });
  });

  it('sait ce que possède un joueur et affiche les prix', () => {
    const owned = new Set(['tool:map']);
    expect(owns(owned, 'tool:map')).toBe(true);
    expect(owns(owned, 'skin:aventure')).toBe(true); // inclus
    expect(owns(owned, 'skin:pirates')).toBe(false);
    expect(priceLabel({ price: 299, included: false })).toBe('2,99 €');
    expect(priceLabel({ price: 0, included: true })).toBe('Inclus');
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length);
  });
});
