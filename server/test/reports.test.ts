import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

/** Une chasse géolocalisée de Seb, partagée au catalogue. */
async function geoEntry() {
  const seb = await loginAs(ctx.app, 'seb@example.com');
  const job = await seb.post('/api/hunts/generate', {
    location: { query: 'Montpellier', lat: 43.6085, lng: 3.8795 },
    durationMinutes: 45,
    travel: 'walk',
    difficulty: 'easy',
    theme: null,
    steps: 3,
    mode: 'organize',
  });
  await ctx.app.service.settle();
  const huntId = (await seb.get(`/api/generations/${job.body.id}`)).body.huntId;
  return (await seb.post(`/api/hunts/${huntId}/catalog`, { summary: 'x', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null })).body.id as number;
}

async function checkinTo(api: Awaited<ReturnType<typeof loginAs>>, huntId: number, order: number) {
  const s = (await ctx.pool.query('SELECT cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order = $2', [huntId, order])).rows[0];
  return (await api.post(`/api/hunts/${huntId}/checkin`, { lat: s.cod_latitude, lng: s.cod_longitude, accuracy: 5 })).body;
}

describe('signalements et statistiques d’étape', () => {
  it('remonte un problème à l’auteur d’une Secret Track jouée en autonomie, et prévient les autres joueurs', async () => {
    const entry = await geoEntry();
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const hunt = (await zoe.post(`/api/catalog/${entry}/play`)).body;
    await zoe.post(`/api/hunts/${hunt.id}/self-start`);

    // On ne signale qu'une étape atteinte ou cherchée.
    expect((await zoe.post(`/api/hunts/${hunt.id}/reports`, { stepOrder: 3, category: 'closed' })).status).toBe(400);
    const report = await zoe.post(`/api/hunts/${hunt.id}/reports`, { stepOrder: 1, category: 'works', message: ' Échafaudages devant la porte. ' });
    expect(report.status).toBe(201);
    expect(report.body).toMatchObject({ stepOrder: 1, category: 'works', message: 'Échafaudages devant la porte.', nickname: 'Zoé', status: 'open' });
    expect((await client(ctx.app).post(`/api/hunts/${hunt.id}/reports`, { stepOrder: 1, category: 'other' })).status).toBe(401);

    // L'auteur le voit ; la fiche publique prévient, sans le message.
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.get(`/api/catalog/${entry}/reports`)).body.map((r: { id: number }) => r.id)).toEqual([report.body.id]);
    expect((await zoe.get(`/api/catalog/${entry}/reports`)).status).toBe(403);
    const page = (await client(ctx.app).get(`/api/catalog/${entry}`)).body;
    expect(page.openReports).toEqual([{ stepOrder: 1, category: 'works', at: expect.any(String) }]);

    // Traité : il disparaît de la fiche.
    expect((await zoe.post(`/api/reports/${report.body.id}/resolve`, { resolved: true })).status).toBe(404);
    expect((await seb.post(`/api/reports/${report.body.id}/resolve`, { resolved: true })).body).toMatchObject({ status: 'resolved', resolvedAt: expect.any(String) });
    expect((await client(ctx.app).get(`/api/catalog/${entry}`)).body.openReports).toEqual([]);
  });

  it('montre à l’organisateur les signalements de sa Secret Track', async () => {
    // Un joueur d'une équipe encore en course sur la chasse 1, organisée par Camille.
    const r = await ctx.pool.query(
      `SELECT u.htr_email FROM th_teamhunters m JOIN th_teams t ON t.tea_id = m.thr_team_tea JOIN th_hunters u ON u.htr_id = m.thr_hunter_htr
       WHERE t.tea_hunt_hun = 1 AND t.tea_finished IS NULL AND t.tea_started IS NOT NULL ORDER BY t.tea_id LIMIT 1`,
    );
    const player = await loginAs(ctx.app, r.rows[0].htr_email);
    const play = (await player.get('/api/hunts/1/play')).body;
    const res = await player.post('/api/hunts/1/reports', { stepOrder: play.clue.targetOrder, category: 'qr', message: null });
    expect(res.status).toBe(201);
    const camille = await loginAs(ctx.app, 'camille@example.com');
    expect((await camille.get('/api/hunts/1/reports')).body[0]).toMatchObject({ category: 'qr', stepOrder: play.clue.targetOrder, status: 'open' });
    expect((await player.get('/api/hunts/1/reports')).status).toBe(403);
  });

  it('compte par étape les équipes, trouvailles, abandons, jokers, temps et blocages', async () => {
    const entry = (await client(ctx.app).get('/api/catalog?autonomous=1')).body[0].id;
    const emma = await loginAs(ctx.app, 'emma@example.com');
    const hunt = (await emma.post(`/api/catalog/${entry}/play`)).body;
    await emma.post(`/api/hunts/${hunt.id}/self-start`);
    await emma.post(`/api/hunts/${hunt.id}/hints`); // joker sur l'énigme de l'étape 1
    await checkinTo(emma, hunt.id, 1);
    await emma.post(`/api/hunts/${hunt.id}/skip`, {}); // abandon de l'étape 2
    await checkinTo(emma, hunt.id, 3);

    const seb = await loginAs(ctx.app, 'seb@example.com');
    const stats = (await seb.get(`/api/catalog/${entry}/stats`)).body;
    expect(stats.teams).toBeGreaterThanOrEqual(2); // Zoé (bloquée, partie en cours) et Emma
    const [s1, s2, s3] = stats.steps;
    expect(s1).toMatchObject({ order: 1, hints: 1, found: 1 });
    expect(s1.teams).toBeGreaterThanOrEqual(2);
    expect(s2).toMatchObject({ order: 2, skipped: 1, found: 0 });
    expect(s3).toMatchObject({ order: 3, found: 1, stuck: 0 });
    expect(s1.avgMinutes).toEqual(expect.any(Number));
    expect((await emma.get(`/api/catalog/${entry}/stats`)).status).toBe(403);

    const camille = await loginAs(ctx.app, 'camille@example.com');
    const own = (await camille.get('/api/hunts/1/stats')).body;
    expect(own.plays).toBe(1);
    expect(own.steps.length).toBeGreaterThan(0);
    expect(own.steps[0].teams).toBeGreaterThan(0);
  });
});
