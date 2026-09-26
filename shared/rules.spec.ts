import { Hunt, HintUse, Step, Team, Validation } from './models.js';
import { checkinAllowance, computeRanking, distanceMeters, evaluateScan, penaltyMinutes, randomToken, ScanContext, teamPosition, teamStartTimes } from './rules.js';

const T0 = Date.parse('2026-09-24T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

function team(id: number, extra: Partial<Team> = {}): Team {
  return { id, huntId: 1, name: `T${id}`, ownerId: id, joinCode: `C${id}`, solo: false, startOrder: null, started: null, finished: null, members: [], ...extra };
}

function hunt(extra: Partial<Hunt> = {}): Hunt {
  return {
    id: 1, ownerId: 99, ownerNickname: 'orga', name: 'H', description: '', location: '', begin: at(0), end: at(240),
    started: at(0), closed: null, autoStart: false, autoClose: false, award: null, startMode: 'mass', interval: null,
    hintPenalties: [0, 0, 0], skipPenalty: 30, validation: 'qr', geoRadius: 40, generated: false, surprise: false, hostId: null, hostNickname: null, selfPaced: true, catalogId: null, teamGame: true, teamMin: 1, teamMax: 4, isPublic: true, joinCode: 'X', contribution: 0,
    startText: null, status: 'running', stepCount: 3, teamCount: 0, ...extra,
  };
}

const steps: Step[] = [0, 1, 2, 3].map((order) => ({
  id: order + 10, huntId: 1, order, token: order ? `tok${order}` : null, title: `S${order}`, arrival: null,
  instructions: order < 3 ? `clue ${order}` : null, hints: [], answer: null, latitude: null, longitude: null, address: null, referencePhoto: false,
}));

describe('teamStartTimes', () => {
  it('fait partir toutes les équipes ensemble en départ groupé', () => {
    const starts = teamStartTimes({ startMode: 'mass', interval: null }, [team(1), team(2)], at(0));
    expect(starts.get(1)).toBe(at(0));
    expect(starts.get(2)).toBe(at(0));
  });

  it('échelonne les départs selon l’ordre de passage, les équipes sans ordre en dernier', () => {
    const teams = [team(1, { startOrder: 2 }), team(2), team(3, { startOrder: 1 })];
    const starts = teamStartTimes({ startMode: 'staggered', interval: 10 }, teams, at(0));
    expect(starts.get(3)).toBe(at(0));
    expect(starts.get(1)).toBe(at(10));
    expect(starts.get(2)).toBe(at(20));
  });
});

describe('evaluateScan', () => {
  const base = (extra: Partial<ScanContext> = {}): ScanContext => ({
    hunt: hunt(), steps, step: steps[1], viewerId: 1, team: team(1, { started: at(0) }), validations: [], now: T0 + 30 * 60_000, ...extra,
  });
  const validated = (...orders: number[]): Validation[] =>
    orders.map((o) => ({ teamId: 1, stepId: o + 10, hunterId: 1, source: 'QR', at: at(o) }));

  it('valide l’étape suivante', () => expect(evaluateScan(base())).toBe('validated'));
  it('refuse une étape sautée', () => expect(evaluateScan(base({ step: steps[2] }))).toBe('skipped'));
  it('reconnaît une étape déjà validée', () => expect(evaluateScan(base({ validations: validated(1) }))).toBe('already_validated'));
  it('accepte l’arrivée après toutes les étapes', () =>
    expect(evaluateScan(base({ step: steps[3], validations: validated(1, 2) }))).toBe('validated'));
  it('signale un jeton inconnu', () => expect(evaluateScan(base({ step: null }))).toBe('unknown'));
  it('masque une chasse en brouillon', () => expect(evaluateScan(base({ hunt: hunt({ status: 'draft' }) }))).toBe('unknown'));
  it('annonce une chasse pas encore commencée', () =>
    expect(evaluateScan(base({ hunt: hunt({ status: 'published', started: null }) }))).toBe('not_started'));
  it('annonce une chasse close, même non connecté', () =>
    expect(evaluateScan(base({ hunt: hunt({ status: 'closed' }), viewerId: null }))).toBe('closed'));
  it('demande la connexion', () => expect(evaluateScan(base({ viewerId: null, team: null }))).toBe('login_required'));
  it('passe en mode organisateur', () => expect(evaluateScan(base({ viewerId: 99, team: null }))).toBe('organizer'));
  it('refuse un joueur non inscrit', () => expect(evaluateScan(base({ team: null }))).toBe('not_registered'));
  it('fait attendre une équipe pas encore partie', () =>
    expect(evaluateScan(base({ team: team(1, { started: at(45) }) }))).toBe('team_not_started'));
  it('ne revalide rien après l’arrivée', () =>
    expect(evaluateScan(base({ team: team(1, { started: at(0), finished: at(20) }) }))).toBe('team_finished'));
});

describe('computeRanking', () => {
  const vals = (teamId: number, n: number): Validation[] =>
    Array.from({ length: n }, (_, i) => ({ teamId, stepId: i + 11, hunterId: teamId, source: 'QR', at: at(10 * (i + 1)) }));
  const hint = (teamId: number, level = 1): HintUse => ({ teamId, stepId: 10, level, hunterId: teamId, at: at(1) });

  it('classe par temps de parcours (arrivée − départ), pas par heure d’arrivée', () => {
    // A part à 0 et arrive à 60 (60 min) ; B part à 20 et arrive à 70 (50 min).
    const teams = [team(1, { started: at(0), finished: at(60) }), team(2, { started: at(20), finished: at(70) })];
    const rows = computeRanking({ hintPenalties: [0, 0, 0], skipPenalty: 30 }, teams, [...vals(1, 3), ...vals(2, 3)], []);
    expect(rows.map((r) => [r.teamId, r.rank])).toEqual([[2, 1], [1, 2]]);
  });

  it('en départ groupé, revient au premier arrivé', () => {
    const teams = [team(1, { started: at(0), finished: at(80) }), team(2, { started: at(0), finished: at(70) })];
    expect(computeRanking({ hintPenalties: [0, 0, 0], skipPenalty: 30 }, teams, [], [])[0].teamId).toBe(2);
  });

  it('ajoute la pénalité de chaque joker selon son niveau', () => {
    const teams = [team(1, { started: at(0), finished: at(60) }), team(2, { started: at(0), finished: at(65) })];
    const rows = computeRanking({ hintPenalties: [2, 8, 15], skipPenalty: 30 }, teams, [], [hint(1, 1), hint(1, 2)]);
    expect(rows[0].teamId).toBe(2);
    expect(rows[1].time).toBe(70 * 60);
    expect(rows[1].penalty).toBe(600);
  });

  it('ajoute la pénalité de chaque épreuve abandonnée', () => {
    // A : 60 min avec un abandon (+30) ; B : 80 min sans abandon.
    const teams = [team(1, { started: at(0), finished: at(60) }), team(2, { started: at(0), finished: at(80) })];
    const v: Validation[] = [
      { teamId: 1, stepId: 11, hunterId: 1, source: 'SKIP', at: at(20) },
      { teamId: 1, stepId: 12, hunterId: 1, source: 'QR', at: at(40) },
    ];
    const rows = computeRanking({ hintPenalties: [0, 0, 0], skipPenalty: 30 }, teams, v, []);
    expect(rows.map((r) => r.teamId)).toEqual([2, 1]);
    expect(rows[1]).toMatchObject({ skips: 1, penalty: 30 * 60, time: 90 * 60 });
  });

  it('cumule jokers et abandons', () => {
    const hunt = { hintPenalties: [2, 5, 10], skipPenalty: 20 };
    expect(penaltyMinutes(hunt, [{ level: 1 }, { level: 2 }], [{ source: 'SKIP' }, { source: 'QR' }, { source: 'MANUAL' }])).toBe(27);
  });

  it('départage les non-arrivées au temps écoulé depuis leur propre départ', () => {
    // Même nombre d'étapes : 1 a validé 30 min après son départ, 2 seulement 20 min après le sien.
    const teams = [team(1, { started: at(0) }), team(2, { started: at(20) })];
    const v: Validation[] = [
      { teamId: 1, stepId: 11, hunterId: 1, source: 'QR', at: at(30) },
      { teamId: 2, stepId: 11, hunterId: 2, source: 'QR', at: at(40) },
    ];
    const rows = computeRanking({ hintPenalties: [0, 0, 0], skipPenalty: 30 }, teams, v, []);
    expect(rows.map((r) => r.teamId)).toEqual([2, 1]);
    expect(teamPosition(rows, 1)).toEqual({ rank: 2, total: 2 });
  });

  it('place les équipes non arrivées après, par nombre d’étapes', () => {
    const teams = [team(1, { started: at(0) }), team(2, { started: at(0) }), team(3, { started: at(0), finished: at(90) })];
    const rows = computeRanking({ hintPenalties: [0, 0, 0], skipPenalty: 30 }, teams, [...vals(1, 1), ...vals(2, 2)], []);
    expect(rows.map((r) => [r.teamId, r.rank])).toEqual([[3, 1], [2, null], [1, null]]);
  });
});

describe('randomToken', () => {
  it('produit 22 caractères base62 différents à chaque appel', () => {
    const a = randomToken();
    expect(a).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(randomToken()).not.toBe(a);
  });
});

describe('géolocalisation', () => {
  it('mesure la distance entre deux points', () => {
    // Place de la Comédie → Arc de triomphe du Peyrou (Montpellier) : environ 1 km.
    const d = distanceMeters({ lat: 43.6085, lng: 3.8797 }, { lat: 43.6115, lng: 3.8704 });
    expect(d).toBeGreaterThan(750);
    expect(d).toBeLessThan(900);
    expect(distanceMeters({ lat: 43.6, lng: 3.88 }, { lat: 43.6, lng: 3.88 })).toBe(0);
  });

  it('élargit le rayon de l’imprécision du GPS, dans une limite', () => {
    expect(checkinAllowance({ geoRadius: 40 }, 12)).toBe(52);
    expect(checkinAllowance({ geoRadius: 40 }, 500)).toBe(70);
    expect(checkinAllowance({ geoRadius: 40 }, null)).toBe(40);
  });
});
