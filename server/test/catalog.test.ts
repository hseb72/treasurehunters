import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

/** Chasse 3 du jeu de démonstration : close, organisée par Camille. */
const PALAVAS = 3;
const publication = (extra: object = {}) => ({ summary: '', difficulty: 'medium', durationMinutes: 90, sampleOrder: 0, changes: null, ...extra });

/** Un joueur de la chasse close (pour la noter). */
async function palavasPlayer() {
  const r = await ctx.pool.query(
    `SELECT u.htr_email FROM th_teamhunters m JOIN th_hunters u ON u.htr_id = m.thr_hunter_htr WHERE m.thr_hunt_hun = $1 ORDER BY m.thr_id LIMIT 1`,
    [PALAVAS],
  );
  return loginAs(ctx.app, r.rows[0].htr_email);
}

describe('catalogue', () => {
  let original: number;
  let copyHunt: number;

  it('publie une chasse, avec un extrait choisi, et la montre sans son parcours', async () => {
    const camille = await loginAs(ctx.app, 'camille@example.com');
    expect((await camille.post(`/api/hunts/${PALAVAS}/catalog`, publication({ sampleOrder: 99 }))).status).toBe(400);
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.post(`/api/hunts/${PALAVAS}/catalog`, publication())).status).toBe(403);

    const res = await camille.post(`/api/hunts/${PALAVAS}/catalog`, publication({ sampleOrder: 1, summary: 'Une balade au bord de l’eau.' }));
    expect(res.status).toBe(201);
    original = res.body.id;
    expect(res.body).toMatchObject({ authorNickname: 'Camille', summary: 'Une balade au bord de l’eau.', parent: null, huntId: PALAVAS, plays: 1 });
    expect(res.body.sample.order).toBe(1);
    expect(res.body.measuredMinutes).toEqual(expect.any(Number));

    const anonymous = client(ctx.app);
    const list = (await anonymous.get('/api/catalog?q=bord')).body;
    expect(list.map((e: { id: number }) => e.id)).toEqual([original]);
    const detail = (await anonymous.get(`/api/catalog/${original}`)).body;
    expect(detail.sample.text).toBeTruthy();
    expect(detail.huntId).toBeNull(); // la chasse de l'auteur n'est montrée qu'à lui
    expect(JSON.stringify(detail)).not.toContain('cat_content');
  });

  it('copie une version en brouillon, avec de nouveaux QR codes', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const copy = await seb.post(`/api/catalog/${original}/copy`);
    expect(copy.status).toBe(201);
    copyHunt = copy.body.id;
    expect(copy.body).toMatchObject({ status: 'draft', catalogId: original, ownerNickname: 'seb', isPublic: false });
    const mine = (await seb.get(`/api/hunts/${copyHunt}/steps`)).body;
    const camille = await loginAs(ctx.app, 'camille@example.com');
    const theirs = (await camille.get(`/api/hunts/${PALAVAS}/steps`)).body;
    expect(mine.map((s: { title: string }) => s.title)).toEqual(theirs.map((s: { title: string }) => s.title));
    expect(mine[1].token).not.toBe(theirs[1].token);
  });

  it('ne republie une copie que modifiée, comme nouvelle version de l’originale', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const same = await seb.post(`/api/hunts/${copyHunt}/catalog`, publication());
    expect(same.status).toBe(409);
    expect(same.body.message).toMatch(/n’a pas changé/);

    const steps = (await seb.get(`/api/hunts/${copyHunt}/steps`)).body;
    await seb.patch(`/api/steps/${steps[1].id}`, { instructions: 'Une énigme réécrite, plus retorse.' });
    const version = await seb.post(`/api/hunts/${copyHunt}/catalog`, publication({ changes: 'Énigme 1 réécrite.' }));
    expect(version.status).toBe(201);
    expect(version.body).toMatchObject({ parent: { id: original, authorNickname: 'Camille' }, changes: 'Énigme 1 réécrite.' });

    const parent = (await client(ctx.app).get(`/api/catalog/${original}`)).body;
    expect(parent.versionCount).toBe(1);
    expect(parent.versions).toEqual([expect.objectContaining({ id: version.body.id, authorNickname: 'seb' })]);

    // L'auteur retire sa version : elle disparaît du catalogue, sauf pour lui.
    expect((await client(ctx.app).del(`/api/catalog/${version.body.id}`)).status).toBe(401);
    expect((await seb.del(`/api/catalog/${version.body.id}`)).body.withdrawn).toBe(true);
    expect((await client(ctx.app).get(`/api/catalog/${version.body.id}`)).status).toBe(404);
    expect((await seb.get('/api/catalog?mine=1')).body.map((e: { id: number }) => e.id)).toEqual([version.body.id]);
    expect((await seb.get(`/api/catalog?hunt=${copyHunt}`)).body.map((e: { id: number }) => e.id)).toEqual([version.body.id]);
    expect((await seb.get(`/api/catalog?hunt=${PALAVAS}`)).body).toEqual([]); // pas sa chasse
    expect((await client(ctx.app).get(`/api/catalog/${original}`)).body.versionCount).toBe(0);
  });
});

describe('notations', () => {
  const rating = { stars: 4, riddles: 5, route: 3, mood: 4, comment: 'Très belle balade !', organizer: 5 };

  it('laisse les joueurs noter une chasse close, et l’organisateur s’il l’accepte', async () => {
    const player = await palavasPlayer();
    const state = (await player.get(`/api/hunts/${PALAVAS}/rating`)).body;
    expect(state).toMatchObject({ canRate: true, organizerRateable: true, organizerNickname: 'Camille', mine: null });
    expect((await player.put(`/api/hunts/${PALAVAS}/rating`, { ...rating, stars: 6 })).status).toBe(400);
    expect((await player.put(`/api/hunts/${PALAVAS}/rating`, rating)).body.mine).toEqual(rating);
    // Un second avis remplace le premier.
    expect((await player.put(`/api/hunts/${PALAVAS}/rating`, { ...rating, stars: 5 })).body.mine.stars).toBe(5);

    const camille = await loginAs(ctx.app, 'camille@example.com');
    expect((await camille.put(`/api/hunts/${PALAVAS}/rating`, rating)).status).toBe(403); // l'organisateur
    const outsider = await loginAs(ctx.app, 'louis@example.com');
    const outside = (await outsider.get(`/api/hunts/${PALAVAS}/rating`)).body;
    if (!outside.canRate) expect((await outsider.put(`/api/hunts/${PALAVAS}/rating`, rating)).status).toBe(403);
    expect((await player.put('/api/hunts/1/rating', rating)).status).toBe(403); // chasse pas encore close
  });

  it('fait remonter les avis au catalogue et à la fiche d’organisateur', async () => {
    const [entry] = (await client(ctx.app).get('/api/catalog?q=bord')).body;
    expect(entry.rating).toMatchObject({ count: 1, stars: 5, riddles: 5, route: 3, mood: 4 });
    const detail = (await client(ctx.app).get(`/api/catalog/${entry.id}`)).body;
    expect(detail.reviews).toEqual([expect.objectContaining({ stars: 5, comment: 'Très belle balade !' })]);

    const profile = (await client(ctx.app).get('/api/organizers/2')).body;
    expect(profile).toMatchObject({ nickname: 'Camille', rateable: true, rating: { count: 1, stars: 5 } });
    expect(profile.entries.map((e: { id: number }) => e.id)).toContain(entry.id);

    // Sans son accord, l'organisateur n'est pas noté.
    const camille = await loginAs(ctx.app, 'camille@example.com');
    expect((await camille.patch('/api/me', { rateable: false })).body.rateable).toBe(false);
    expect((await client(ctx.app).get('/api/organizers/2')).body.rating).toBeNull();
  });
});
