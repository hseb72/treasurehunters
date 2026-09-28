import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, loginAs, publishedEntry, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('rôles dans l’équipe (§ 41)', () => {
  it('chacun choisit le sien, le créateur répartit, un seul capitaine', async () => {
    const { entry } = await publishedEntry(ctx, 'seb@example.com');
    const camille = await loginAs(ctx.app, 'camille@example.com');
    const hunt = (await camille.post(`/api/catalog/${entry.id}/copy`)).body;
    await camille.patch(`/api/hunts/${hunt.id}`, { isPublic: true });
    expect((await camille.post(`/api/hunts/${hunt.id}/publish`)).status).toBe(200);
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const team = (await zoe.post(`/api/hunts/${hunt.id}/teams`, { name: 'Les Zèbres' })).body;
    const hugo = await loginAs(ctx.app, 'hugo@example.com');
    const joined = await hugo.post('/api/teams/join', { code: team.joinCode });
    expect(joined.status).toBe(200);
    const hugoId = joined.body.members.find((m: { nickname: string }) => m.nickname !== team.members[0].nickname).hunterId;
    const zoeId = team.members[0].hunterId;

    let t = (await hugo.put(`/api/teams/${team.id}/role`, { role: 'navigator' })).body;
    expect(t.members.find((m: { hunterId: number }) => m.hunterId === hugoId).role).toBe('navigator');
    // Hugo n'a pas créé l'équipe : il ne choisit pas pour Zoé.
    expect((await hugo.put(`/api/teams/${team.id}/role`, { role: 'reader', hunterId: zoeId })).status).toBe(403);
    t = (await zoe.put(`/api/teams/${team.id}/role`, { role: 'captain' })).body;
    // Zoé nomme Hugo capitaine : elle cesse de l'être.
    t = (await zoe.put(`/api/teams/${team.id}/role`, { role: 'captain', hunterId: hugoId })).body;
    const roles = Object.fromEntries(t.members.map((m: { hunterId: number; role: string | null }) => [m.hunterId, m.role]));
    expect(roles).toEqual({ [zoeId]: null, [hugoId]: 'captain' });
    expect((await zoe.put(`/api/teams/${team.id}/role`, { role: 'pilot' })).status).toBe(400);
    const camilleTeam = await camille.put(`/api/teams/${team.id}/role`, { role: 'reader' });
    expect(camilleTeam.status).toBe(404);
  });
});
