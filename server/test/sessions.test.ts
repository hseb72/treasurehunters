import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, loginAs, publishedEntry, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('sessions d’une version du catalogue (§ 40)', () => {
  it('une copie organisée, publique et ouverte, apparaît sur la fiche et dans le filtre', async () => {
    const { entry } = await publishedEntry(ctx, 'camille@example.com');
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.get(`/api/catalog/${entry.id}`)).body).toMatchObject({ sessions: [], nextSession: null });

    const copy = (await seb.post(`/api/catalog/${entry.id}/copy`)).body;
    const begin = new Date(Date.now() + 3 * 3_600_000);
    const end = new Date(begin.getTime() + 3 * 3_600_000);
    const updated = await seb.patch(`/api/hunts/${copy.id}`, { name: 'Rallye du samedi', isPublic: true, begin: begin.toISOString(), end: end.toISOString(), startMode: 'staggered', interval: 10 });
    expect(updated.status).toBe(200);
    // Brouillon : pas encore une session.
    expect((await seb.get(`/api/catalog/${entry.id}`)).body.sessions).toEqual([]);
    expect((await seb.post(`/api/hunts/${copy.id}/publish`)).body.status).toBe('published');

    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    await zoe.post(`/api/hunts/${copy.id}/teams`, { name: 'Les Zèbres' });
    const detail = (await zoe.get(`/api/catalog/${entry.id}`)).body;
    expect(detail.nextSession).toBe(begin.toISOString());
    expect(detail.sessions).toEqual([
      expect.objectContaining({ huntId: copy.id, name: 'Rallye du samedi', organizerNickname: 'seb', status: 'published', teams: 1, startMode: 'staggered', interval: 10, mine: true }),
    ]);
    const ids = async (qs: string) => ((await ctx.app.inject({ url: `/api/catalog?${qs}` })).json() as { id: number }[]).map((x) => x.id);
    expect(await ids('session=week')).toContain(entry.id);

    // Privée : plus une session.
    await seb.patch(`/api/hunts/${copy.id}`, { isPublic: false });
    expect((await zoe.get(`/api/catalog/${entry.id}`)).body.sessions).toEqual([]);
    expect(await ids('session=week')).not.toContain(entry.id);
  });
});
