import { CatalogEntry } from './models.js';
import { pickSurprise } from './surprise.js';

const entry = (id: number, e: Partial<CatalogEntry> = {}) =>
  ({ id, validation: 'geo', withdrawn: false, durationMinutes: 90, measuredMinutes: null, finishers: 0, travel: 'walk', distanceKm: 1, rating: { count: 0, stars: null }, ...e }) as CatalogEntry;

describe('surprends-moi (§ 37)', () => {
  it('écarte les parties jouées, trop longues, déjà proposées ou à QR', () => {
    const all = [entry(1), entry(2, { durationMinutes: 240 }), entry(3, { validation: 'qr' }), entry(4), entry(5)];
    const r = pickSurprise(all, { played: new Set([1]), usualTravel: null, minutes: 120, exclude: [4], random: () => 0 });
    expect(r.entry?.id).toBe(5);
    expect(r.reasons).toEqual(['Départ à 1 km', '1 h 30, dans votre temps', 'Pas encore jouée']);
  });

  it('préfère la durée constatée quand assez d’équipes sont arrivées, et le déplacement habituel', () => {
    const slow = entry(1, { durationMinutes: 60, measuredMinutes: 200, finishers: 5 });
    const bike = entry(2, { travel: 'active', rating: { count: 2, stars: 4 } as CatalogEntry['rating'] });
    const walk = entry(3, { rating: { count: 2, stars: 4 } as CatalogEntry['rating'] });
    expect(pickSurprise([slow, bike, walk], { played: new Set(), usualTravel: 'active', minutes: 120, random: () => 0 }).entry?.id).toBe(2);
    expect(pickSurprise([slow], { played: new Set(), usualTravel: null, minutes: 120 }).entry).toBeNull();
  });
});
