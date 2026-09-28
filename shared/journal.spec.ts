import { cityOf, explorerJournal, JournalHunt } from './journal.js';

const hunt = (over: Partial<JournalHunt>): JournalHunt => ({
  huntId: 1,
  name: 'Secret Track',
  location: 'Montpellier, l’Écusson',
  skin: 'aventure',
  date: '2026-09-01T10:00:00Z',
  time: 3600,
  found: 4,
  hints: 1,
  autonomous: false,
  catalogId: null,
  km: 2.5,
  ...over,
});

describe('explorerJournal', () => {
  it('range les Secret Tracks, compte villes, étapes et kilomètres, et accorde les badges', () => {
    const j = explorerJournal([
      hunt({ huntId: 1 }),
      hunt({ huntId: 2, location: 'Sète', date: '2026-09-10T10:00:00Z', hints: 0, autonomous: true }),
      hunt({ huntId: 3, location: 'montpellier, Antigone', date: '2026-09-05T10:00:00Z' }),
    ]);
    expect(j.hunts.map((h) => h.huntId)).toEqual([2, 3, 1]);
    expect(j.cities).toEqual(['Sète', 'montpellier']);
    expect(j.totals).toEqual({ hunts: 3, steps: 12, km: 7.5 });
    const earned = j.badges.filter((b) => b.earned).map((b) => b.id);
    expect(earned).toEqual(['first', 'clean', 'solo']);
  });

  it('un carnet vide n’a aucun badge', () => {
    const j = explorerJournal([]);
    expect(j.totals).toEqual({ hunts: 0, steps: 0, km: 0 });
    expect(j.badges.every((b) => !b.earned)).toBe(true);
  });

  it('prend la ville avant la virgule', () => {
    expect(cityOf(' Paris , Montmartre')).toBe('Paris');
    expect(cityOf('34250 Palavas-les-Flots')).toBe('Palavas-les-Flots');
  });
});
