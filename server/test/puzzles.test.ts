import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('énigmes d’arrivée', () => {
  it('se valident sur place par la bonne réponse, ou s’abandonnent', async () => {
    const tom = await loginAs(ctx.app, 'tom@example.com');
    const started = await tom.post('/api/hunts/generate', {
      location: { query: 'Montpellier', lat: 43.6085, lng: 3.8795 },
      durationMinutes: 45, travel: 'walk', difficulty: 'medium', theme: null, steps: null, mode: 'organize',
    });
    await ctx.app.service.settle();
    const huntId = (await tom.get(`/api/generations/${started.body.id}`)).body.huntId;
    const steps = (await tom.get(`/api/hunts/${huntId}/steps`)).body;

    // Question sur place : incluse. Cadenas : pack « Codes secrets » à obtenir.
    const question = { type: 'question', prompt: 'Quelle année est gravée sur la fontaine ?', answer: '1789|mille sept cent quatre-vingt-neuf', hint: 'La Révolution' };
    expect((await tom.patch(`/api/steps/${steps[1].id}`, { puzzle: question })).body.puzzle).toMatchObject({ type: 'question' });
    expect((await tom.patch(`/api/steps/${steps[0].id}`, { puzzle: question })).status).toBe(400); // pas au départ
    const lock = { type: 'lock', prompt: 'Le code est le nombre de marches.', answer: '0042' };
    const refused = await tom.patch(`/api/steps/${steps[2].id}`, { puzzle: lock });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Codes secrets/);
    await tom.post('/api/store/pack:codes/acquire');
    expect((await tom.patch(`/api/steps/${steps[2].id}`, { puzzle: { ...lock, answer: '42' } })).status).toBe(400);
    expect((await tom.patch(`/api/steps/${steps[2].id}`, { puzzle: lock })).status).toBe(200);

    await tom.post(`/api/hunts/${huntId}/publish`);
    const lea = await loginAs(ctx.app, 'lea@example.com');
    await lea.post(`/api/hunts/${huntId}/teams`, { name: 'Énigmes' });
    await tom.post(`/api/hunts/${huntId}/start`);
    const at = (s: { latitude: number; longitude: number }) => ({ lat: s.latitude, lng: s.longitude, accuracy: 5 });

    // Arrivée : l'énigme attend, sans sa réponse ni son indice.
    const arrived = (await lea.post(`/api/hunts/${huntId}/checkin`, at(steps[1]))).body;
    expect(arrived).toMatchObject({ outcome: 'puzzle', step: null });
    expect(arrived.state.clue.targetOrder).toBe(1);
    expect(arrived.state.puzzle).toMatchObject({ order: 1, attempts: 0, hasHint: true, hintShown: false, puzzle: { type: 'question', hint: null } });
    expect(JSON.stringify(arrived.state)).not.toContain('1789');

    const wrong = (await lea.post(`/api/hunts/${huntId}/puzzle`, { answer: '1790' })).body;
    expect(wrong).toMatchObject({ correct: false, step: null });
    expect(wrong.state.puzzle.attempts).toBe(1);
    expect((await lea.post(`/api/hunts/${huntId}/puzzle/hint`)).body.puzzle).toMatchObject({ hintShown: true, puzzle: { hint: 'La Révolution' } });
    const right = (await lea.post(`/api/hunts/${huntId}/puzzle`, { answer: 'Mille-sept-cent-quatre-vingt-neuf' })).body;
    expect(right).toMatchObject({ correct: true, step: { order: 1 } });
    expect(right.state).toMatchObject({ puzzle: null, clue: { targetOrder: 2 } });
    expect(right.state.validated.at(-1)).toMatchObject({ order: 1, skipped: false });

    // Cadenas trop dur : on abandonne l'épreuve, l'arrivée en attente disparaît.
    expect((await lea.post(`/api/hunts/${huntId}/checkin`, at(steps[2]))).body.outcome).toBe('puzzle');
    const skipped = (await lea.post(`/api/hunts/${huntId}/skip`)).body;
    expect(skipped).toMatchObject({ puzzle: null, clue: { targetOrder: 3 } });
    expect((await lea.post(`/api/hunts/${huntId}/puzzle`, { answer: '0042' })).status).toBe(409);
  });

  it('attend aussi après un scan de QR code', async () => {
    const r = await ctx.pool.query(
      `SELECT u.htr_email, t.tea_id FROM th_teamhunters m JOIN th_teams t ON t.tea_id = m.thr_team_tea JOIN th_hunters u ON u.htr_id = m.thr_hunter_htr
       WHERE t.tea_hunt_hun = 1 AND t.tea_finished IS NULL AND t.tea_started IS NOT NULL ORDER BY t.tea_id LIMIT 1`,
    );
    const player = await loginAs(ctx.app, r.rows[0].htr_email);
    const target = (await player.get('/api/hunts/1/play')).body.clue.targetOrder;
    const step = (await ctx.pool.query('SELECT cod_id, cod_longid FROM th_codes WHERE cod_hunt_hun = 1 AND cod_order = $1', [target])).rows[0];
    await ctx.pool.query(`UPDATE th_codes SET cod_puzzle = $2 WHERE cod_id = $1`, [step.cod_id, JSON.stringify({ type: 'anagram', prompt: 'Remettez les lettres dans l’ordre.', answer: 'phare' })]);

    const scan = (await player.post(`/api/scan/${step.cod_longid}`)).body;
    expect(scan.outcome).toBe('puzzle');
    expect(scan.step.arrival).toBeNull(); // le message d'arrivée vient avec la bonne réponse
    const state = (await player.get('/api/hunts/1/play')).body;
    expect(state.puzzle.puzzle.letters.sort()).toEqual(['A', 'E', 'H', 'P', 'R']);
    const solved = (await player.post('/api/hunts/1/puzzle', { answer: 'Phare' })).body;
    expect(solved).toMatchObject({ correct: true, state: { clue: { targetOrder: target + 1 } } });
    const source = await ctx.pool.query('SELECT val_source FROM th_validations WHERE val_team_tea = $1 AND val_code_cod = $2', [r.rows[0].tea_id, step.cod_id]);
    expect(source.rows).toEqual([{ val_source: 'QR' }]);
  });
});
