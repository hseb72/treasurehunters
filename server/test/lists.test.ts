import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, loginAs, publishedEntry, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('favoris et listes (§ 38)', () => {
  it('« À faire » d’office, listes à soi, partage par code et remplissage à plusieurs', async () => {
    const cat: number = (await publishedEntry(ctx, 'camille@example.com')).entry.id;
    const seb = await loginAs(ctx.app, 'seb@example.com');

    const [fav, ...others] = (await seb.get('/api/me/lists')).body;
    expect(fav).toMatchObject({ favorite: true, name: 'À faire', mine: true, catalogIds: [] });
    expect(others).toEqual([]);
    expect((await seb.get('/api/me/lists')).body).toHaveLength(1); // pas de doublon

    expect((await seb.put(`/api/lists/${fav.id}/items/${cat}`, {})).body.catalogIds).toEqual([cat]);
    expect((await seb.put(`/api/lists/${fav.id}/items/${cat}`, {})).body.catalogIds).toEqual([cat]); // idempotent
    expect((await seb.del(`/api/lists/${fav.id}`)).status).toBe(409);

    const weekend = (await seb.post('/api/lists', { name: 'Week-end à Toulouse', icon: 'place' })).body;
    await seb.put(`/api/lists/${weekend.id}/items/${cat}`, {});
    const shared = (await seb.patch(`/api/lists/${weekend.id}`, { shared: true })).body;
    expect(shared.code).toMatch(/^[A-Z2-9]{8}$/);

    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    expect((await zoe.get(`/api/lists/${weekend.id}`)).status).toBe(404);
    const joined = (await zoe.post('/api/lists/join', { code: shared.code.toLowerCase() })).body;
    expect(joined).toMatchObject({ id: weekend.id, mine: false, ownerNickname: 'seb' });
    const detail = (await zoe.get(`/api/lists/${weekend.id}`)).body;
    expect(detail.entries.map((e: { id: number }) => e.id)).toEqual([cat]);
    await zoe.del(`/api/lists/${weekend.id}/items/${cat}`);
    expect((await zoe.patch(`/api/lists/${weekend.id}`, { name: 'À moi' })).status).toBe(403);
    expect((await seb.get(`/api/lists/${weekend.id}`)).body).toMatchObject({ catalogIds: [], members: [expect.any(String)] });

    // Ne plus partager : les membres sortent.
    await seb.patch(`/api/lists/${weekend.id}`, { shared: false });
    expect((await zoe.get(`/api/lists/${weekend.id}`)).status).toBe(404);
    expect((await zoe.post('/api/lists/join', { code: shared.code })).status).toBe(404);
    expect((await seb.post('/api/lists', { name: 'x', icon: 'rocket' })).status).toBe(400);
  });
});
