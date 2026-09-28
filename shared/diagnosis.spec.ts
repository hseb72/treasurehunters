import { diagnoseSteps } from './diagnosis.js';
import { stepReliability } from './gps.js';
import { HuntStats } from './models.js';

const stats = (steps: Partial<HuntStats['steps'][number]>[]): HuntStats => ({
  plays: 1,
  teams: 10,
  finished: 8,
  steps: steps.map((s, i) => ({ order: i + 1, title: `Lieu ${i + 1}`, teams: 10, found: 10, skipped: 0, hints: 0, hintTeams: 0, avgMinutes: 3, stuck: 0, ...s })),
});

describe('étapes problématiques (§ 43)', () => {
  it('fait ressortir jokers, temps, abandons, signalements et GPS', () => {
    const gps = [stepReliability({ id: 9, order: 3, title: 'Lieu 3' }, Array.from({ length: 4 }, () => ({ ok: true, distance: 30, accuracy: 10, source: 'test' as const })))];
    const d = diagnoseSteps(stats([{}, { hints: 5, hintTeams: 4, avgMinutes: 9, skipped: 2 }, {}]), { durationMinutes: 9, reports: new Map([[1, 2]]), gps });
    expect(d.map((x) => x.order)).toEqual([1, 2, 3]);
    expect(d[0]).toMatchObject({ signals: ['2 signalements ouverts'], severity: 'warn' });
    expect(d[1]!.signals).toEqual(['40 % des équipes prennent un joker', 'temps moyen 9 min contre 3 min prévues', '20 % abandonnent ici']);
    expect(d[1]!.severity).toBe('alert');
    expect(d[2]!.signals[0]).toMatch(/^GPS instable \(4 déclenchements sur 4 à plus de 20 m/);
  });

  it('ne juge pas une étape sur trop peu d’équipes', () => {
    expect(diagnoseSteps(stats([{ teams: 2, hints: 2, hintTeams: 2, skipped: 1 }]))).toEqual([]);
  });
});
