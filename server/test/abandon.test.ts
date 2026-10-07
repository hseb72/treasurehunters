import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, DEMO_TOKENS, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('abandon de la partie (§ 5.2)', () => {
  it('arrête la partie de toute l’équipe : plus d’énigme, non classée, visible en direct', async () => {
    const enzo = await loginAs(ctx.app, 'enzo@example.com'); // Les Mouettes, en route vers l'étape 4
    expect((await enzo.get('/api/me/in-progress')).body.some((g: { huntId: number }) => g.huntId === 1)).toBe(true);

    const res = await enzo.post('/api/hunts/1/abandon');
    expect(res.status).toBe(200);
    expect(res.body.clue).toBeNull();
    expect(res.body.team.abandoned).not.toBeNull();
    expect((await enzo.post('/api/hunts/1/abandon')).status).toBe(200); // déjà fait : sans effet

    // Plus rien ne se valide, ni joker, ni abandon, ni scan.
    expect((await enzo.post('/api/hunts/1/hints')).status).toBe(409);
    expect((await enzo.post('/api/hunts/1/skip')).status).toBe(409);
    expect((await enzo.post(`/api/scan/${DEMO_TOKENS.nefles[4]}`)).body.outcome).toBe('team_abandoned');
    expect((await enzo.get('/api/me/in-progress')).body.some((g: { huntId: number }) => g.huntId === 1)).toBe(false);

    const camille = await loginAs(ctx.app, 'camille@example.com');
    const live = (await camille.get('/api/hunts/1/live')).body;
    expect(live.find((r: { team: { name: string } }) => r.team.name === 'Les Mouettes').status).toBe('abandoned');
    const ranking = (await camille.get('/api/hunts/1/results')).body as { teamName: string; rank: number | null; abandoned: boolean }[];
    expect(ranking.at(-1)).toMatchObject({ teamName: 'Les Mouettes', rank: null, abandoned: true });
    expect((await camille.post('/api/teams/' + (await teamId('Les Mouettes')) + '/validations', { stepId: await stepId(1, 4) })).status).toBe(409);
  });

  it('refuse avant le départ : on quitte simplement la Secret Track', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com'); // inscrit à une chasse publiée, pas encore partie
    const hunt = await ctx.pool.query(
      `SELECT t.tea_hunt_hun AS id FROM th_teams t JOIN th_teamhunters m ON m.thr_team_tea = t.tea_id JOIN th_hunters h ON h.htr_id = m.thr_hunter_htr
       WHERE h.htr_email = 'seb@example.com' AND t.tea_started IS NULL LIMIT 1`,
    );
    const res = await seb.post(`/api/hunts/${hunt.rows[0].id}/abandon`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/quitter/);
  });
});

describe('historique des parcours (§ 29)', () => {
  type Entry = { huntId: number; name: string; status: string; time: number | null; referenceMinutes: number | null; referenceKind: string | null; found: number; total: number; stars: number | null; canRate: boolean };

  it('liste toutes les parties du joueur avec leur statut', async () => {
    // Enzo a abandonné la partie de la chasse 1 (test précédent).
    const enzo = await loginAs(ctx.app, 'enzo@example.com');
    const history = (await enzo.get('/api/me/journal')).body.history as Entry[];
    const abandoned = history.find((e) => e.huntId === 1)!;
    expect(abandoned).toMatchObject({ status: 'abandoned', canRate: false, stars: null });
    expect(abandoned.time).toBeGreaterThan(0);
    expect(abandoned.found).toBe(3);

    // Seb : une partie en cours, une à venir, et toutes ses autres parties.
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const mine = (await seb.get('/api/me/journal')).body.history as Entry[];
    expect(mine.find((e) => e.huntId === 1)?.status).toBe('running');
    expect(mine.some((e) => e.status === 'upcoming')).toBe(true);
  });

  it('distingue le trésor abandonné, compare au temps de référence et propose de noter une chasse close', async () => {
    const nathan = await loginAs(ctx.app, 'nathan@example.com'); // Les Retardataires : aucune étape
    for (let i = 0; i < 5; i++) expect((await nathan.post('/api/hunts/1/skip')).status).toBe(200);
    await ctx.pool.query('UPDATE th_hunts SET hun_duration = 90 WHERE hun_id = 1');
    const camille = await loginAs(ctx.app, 'camille@example.com');
    expect((await camille.post('/api/hunts/1/close')).status).toBe(200);

    const journal = (await nathan.get('/api/me/journal')).body;
    const entry = (journal.history as Entry[]).find((e) => e.huntId === 1)!;
    expect(entry).toMatchObject({ status: 'treasure_skipped', referenceMinutes: 90, referenceKind: 'announced', found: 0, canRate: true });
    // Le carnet (badges, kilomètres) ne compte que les trésors trouvés.
    expect((journal.hunts as { huntId: number }[]).some((h) => h.huntId === 1)).toBe(false);

    expect((await nathan.put('/api/hunts/1/rating', { stars: 4, riddles: 4, route: 3, mood: 5, comment: null, organizer: null })).status).toBeLessThan(300);
    const rated = ((await nathan.get('/api/me/journal')).body.history as Entry[]).find((e) => e.huntId === 1)!;
    expect(rated).toMatchObject({ stars: 4, canRate: false });
  });
});

async function teamId(name: string): Promise<number> {
  return (await ctx.pool.query('SELECT tea_id FROM th_teams WHERE tea_name = $1', [name])).rows[0].tea_id;
}

async function stepId(huntId: number, order: number): Promise<number> {
  return (await ctx.pool.query('SELECT cod_id FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order = $2', [huntId, order])).rows[0].cod_id;
}
