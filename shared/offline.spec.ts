import { applyOffline, OfflinePack, offlineHash, offlineView } from './offline.js';

const step = (order: number, extra: Partial<OfflinePack['steps'][number]> = {}) => ({
  stepId: 100 + order,
  order,
  title: `Lieu ${order}`,
  arrival: null,
  instructions: order < 3 ? `Énigme ${order}` : null,
  hints: ['a', 'b'],
  lat: 43.6,
  lng: 3.8,
  entrances: [],
  tokenHash: null,
  puzzle: null,
  answerHashes: null,
  ...extra,
});

const pack: OfflinePack = {
  huntId: 1,
  huntName: 'Chasse',
  skin: 'aventure',
  teamName: 'Zoé',
  validation: 'geo',
  geoRadius: 30,
  selfStart: true,
  steps: [step(0), step(1), step(2, { puzzle: { type: 'question', prompt: 'Année ?', hint: null } }), step(3)],
  progress: { started: null, validated: [], hints: {}, puzzle: null },
  downloaded: '2026-09-28T10:00:00Z',
};

describe('carnet hors ligne', () => {
  it('suit la partie : départ, joker, arrivée, épreuve, abandon interdit à l’arrivée', () => {
    let p = pack.progress;
    expect(offlineView(pack, p).phase).toBe('waiting');
    p = applyOffline(pack, p, { id: 'e1', kind: 'start', at: '2026-09-28T10:01:00Z' });
    expect(offlineView(pack, p)).toMatchObject({ phase: 'playing', current: { order: 0 }, target: { order: 1 }, canSkip: true });
    p = applyOffline(pack, p, { id: 'e2', kind: 'hint', stepId: 100, at: '2026-09-28T10:02:00Z' });
    expect(offlineView(pack, p).hintsRevealed).toEqual(['a']);
    p = applyOffline(pack, p, { id: 'e3', kind: 'arrive', stepId: 101, at: '2026-09-28T10:10:00Z', lat: 43.6, lng: 3.8, accuracy: 5 });
    expect(offlineView(pack, p)).toMatchObject({ current: { order: 1 }, target: { order: 2 }, hintsRevealed: [] });
    p = applyOffline(pack, p, { id: 'e4', kind: 'arrive', stepId: 102, at: '2026-09-28T10:20:00Z', lat: 43.6, lng: 3.8, accuracy: 5 });
    expect(offlineView(pack, p).phase).toBe('puzzle');
    p = applyOffline(pack, p, { id: 'e5', kind: 'answer', stepId: 102, at: '2026-09-28T10:22:00Z', answer: '1789' });
    expect(offlineView(pack, p)).toMatchObject({ phase: 'playing', target: { order: 3 }, canSkip: false });
    p = applyOffline(pack, p, { id: 'e6', kind: 'arrive', stepId: 103, at: '2026-09-28T10:30:00Z', lat: 43.6, lng: 3.8, accuracy: 5 });
    expect(offlineView(pack, p).phase).toBe('finished');
  });

  it('empreinte stable, liée à l’étape', async () => {
    expect(await offlineHash(1, 'abc')).toBe(await offlineHash(1, 'abc'));
    expect(await offlineHash(1, 'abc')).not.toBe(await offlineHash(2, 'abc'));
    expect(await offlineHash(1, 'abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
