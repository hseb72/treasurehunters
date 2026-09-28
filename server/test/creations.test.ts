import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
  await ctx.pool.query(`UPDATE th_hunters SET htr_reviewer = true WHERE htr_email = 'seb@example.com'`);
});
afterAll(() => teardown(ctx));

const COVER = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';
const skin = (tokens: Record<string, string>) => ({ scheme: 'dark', tokens, cover: COVER, effects: { validate: 'stamp', treasure: 'confetti', confetti: ['#fff', 'red'] }, sounds: { validate: { tones: [[440, 100]] } } });

describe('créations de la communauté', () => {
  it('fait relire un skin avant de le publier, puis le vend dans la boutique', async () => {
    const camille = await loginAs(ctx.app, 'camille@example.com');
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const zoe = await loginAs(ctx.app, 'zoe@example.com');

    // Un manifeste qui tente de sortir des jetons : refusé, le reste est gardé en brouillon.
    const draft = await camille.post('/api/creations', {
      kind: 'skin',
      name: 'Néon',
      description: 'Une ville la nuit.',
      price: 199,
      content: skin({ primary: '#ff00aa', accent: 'red; } body { display: none', texture: 'url(javascript:alert(1))', 'made-up': '#000' }),
    });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: 'draft', authorNickname: 'Camille', content: { tokens: { primary: '#ff00aa' }, effects: { confetti: ['#fff'] } } });
    expect(draft.body.problems).toHaveLength(3); // signalés, et retirés du brouillon
    expect(Object.keys(draft.body.content.tokens)).toEqual(['primary']);
    const id = draft.body.id;
    // Sans couverture, pas de relecture.
    const bare = (await camille.post('/api/creations', { kind: 'skin', name: 'Nu', description: '', price: 0, content: { tokens: { ink: '#000' } } })).body;
    expect((await camille.post(`/api/creations/${bare.id}/submit`)).status).toBe(400);
    await camille.del(`/api/creations/${bare.id}`);

    await camille.patch(`/api/creations/${id}`, { content: skin({ primary: '#ff00aa', 'page-bg': '#0b0b1a', ink: '#f5f5ff' }) });
    expect((await camille.post(`/api/creations/${id}/submit`)).body.status).toBe('review');
    expect((await camille.patch(`/api/creations/${id}`, { name: 'Néon 2' })).status).toBe(409);

    // Relecture : réservée aux relecteurs ; un refus dit quoi corriger.
    expect((await zoe.get('/api/creations/review')).status).toBe(403);
    expect((await seb.get('/api/creations/review')).body.map((c: { id: number }) => c.id)).toContain(id);
    expect((await seb.post(`/api/creations/${id}/review`, { approve: false })).status).toBe(400);
    const rejected = (await seb.post(`/api/creations/${id}/review`, { approve: false, note: 'Le texte manque de contraste.' })).body;
    expect(rejected).toMatchObject({ status: 'rejected', note: 'Le texte manque de contraste.' });
    await camille.patch(`/api/creations/${id}`, { content: skin({ primary: '#ff00aa', 'page-bg': '#0b0b1a', ink: '#ffffff' }) });
    await camille.post(`/api/creations/${id}/submit`);
    expect((await seb.post(`/api/creations/${id}/review`, { approve: true, note: null })).body.status).toBe('published');
    expect((await camille.del(`/api/creations/${id}`)).status).toBe(409);

    // Boutique et manifeste public.
    const item = (await zoe.get('/api/store')).body.find((i: { id: string }) => i.id === `skin:u${id}`);
    expect(item).toMatchObject({ kind: 'skin', price: 199, owned: false, creator: { nickname: 'Camille' }, skin: { id: `u${id}`, author: 'Camille', tokens: { ink: '#ffffff' } } });
    expect((await client(ctx.app).get(`/api/skins/u${id}`)).body).toMatchObject({ id: `u${id}`, name: 'Néon', scheme: 'dark' });

    // Une chasse ne l'habille qu'une fois obtenu.
    const begin = new Date(Date.now() + 3_600_000).toISOString();
    const hunt = (await zoe.post('/api/hunts', { name: 'Nuit', begin, end: new Date(Date.now() + 7_200_000).toISOString() })).body;
    expect((await zoe.patch(`/api/hunts/${hunt.id}`, { skin: `u${id}` })).status).toBe(403);
    expect((await zoe.patch(`/api/hunts/${hunt.id}`, { skin: 'u999999' })).status).toBe(400);
    await zoe.post(`/api/store/skin:u${id}/acquire`);
    expect((await zoe.patch(`/api/hunts/${hunt.id}`, { skin: `u${id}` })).body.skin).toBe(`u${id}`);
    expect((await zoe.post(`/api/store/pack:u${id}/acquire`)).status).toBe(404); // pas un pack
  });

  it('publie un pack d’énigmes sans jamais en montrer les réponses hors de ceux qui l’ont obtenu', async () => {
    const camille = await loginAs(ctx.app, 'camille@example.com');
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const puzzles = [
      { type: 'anagram', prompt: 'Le métier du capitaine.', answer: 'navigateur', hint: 'Il tient la barre.' },
      { type: 'cipher', prompt: 'Message du bord.', answer: 'terre en vue', hint: '', shift: 5 },
      { type: 'lock', prompt: 'Le coffre du navire.', answer: '12', hint: '' },
    ];
    const pack = (await camille.post('/api/creations', { kind: 'pack', name: 'Mers du Sud', description: 'Énigmes de marins.', price: 299, content: { puzzles } })).body;
    expect(pack.problems.join(' ')).toMatch(/Énigme 3 : .*3 à 6 chiffres/);
    puzzles[2].answer = '1492';
    await camille.patch(`/api/creations/${pack.id}`, { content: { puzzles } });
    await camille.post(`/api/creations/${pack.id}/submit`);
    await seb.post(`/api/creations/${pack.id}/review`, { approve: true, note: null });

    const store = (await zoe.get('/api/store')).body;
    expect(store.find((i: { id: string }) => i.id === `pack:u${pack.id}`)).toMatchObject({ kind: 'pack', puzzleCount: 3, creator: { nickname: 'Camille' } });
    expect(JSON.stringify(store)).not.toContain('navigateur');
    expect((await zoe.get(`/api/creations/${pack.id}/puzzles`)).status).toBe(403);
    await zoe.post(`/api/store/pack:u${pack.id}/acquire`);
    expect((await zoe.get(`/api/creations/${pack.id}/puzzles`)).body.map((p: { answer: string }) => p.answer)).toEqual(['navigateur', 'terre en vue', '1492']);

    // Ses énigmes se posent sans les packs de leur type ; retouchées, elles les demandent.
    const hunt = (await zoe.post('/api/hunts', { name: 'Marins', begin: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString() })).body;
    const step = (await zoe.get(`/api/hunts/${hunt.id}/steps`)).body.find((s: { order: number }) => s.order === 1);
    expect((await zoe.patch(`/api/steps/${step.id}`, { puzzle: { ...puzzles[1], hint: 'Retouché.' } })).status).toBe(200);
    expect((await zoe.patch(`/api/steps/${step.id}`, { puzzle: { ...puzzles[2], answer: '1493' } })).status).toBe(403);

    const page = (await client(ctx.app).get(`/api/creators/${pack.authorId}`)).body;
    expect(page).toMatchObject({ nickname: 'Camille' });
    expect(page.creations.map((c: { kind: string }) => c.kind).sort()).toEqual(['pack', 'skin']);
    expect(JSON.stringify(page)).not.toContain('navigateur');
    expect((await camille.get('/api/creations/mine')).body).toHaveLength(2);
  });
});
