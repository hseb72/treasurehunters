import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx, loginAs, publishedEntry, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

async function published(email: string, pub: Record<string, unknown>) {
  return (await publishedEntry(ctx, email, pub)).entry;
}

describe('je cherche une Secret Track… (§ 36) et surprends-moi (§ 37)', () => {
  it('filtre sur le public, le cadre, le prix et la longueur', async () => {
    const e = await published('seb@example.com', { audience: ['family', 'solo', 'family'], setting: 'indoor' });
    expect(e).toMatchObject({ audience: ['family', 'solo'], setting: 'indoor' });
    const anon = ctx.app;
    const ids = async (qs: string) => ((await anon.inject({ url: `/api/catalog?${qs}` })).json() as { id: number }[]).map((x) => x.id);
    expect(await ids('audience=family,couple')).toContain(e.id);
    expect(await ids('audience=couple')).not.toContain(e.id);
    expect(await ids('setting=indoor')).toContain(e.id);
    expect(await ids('setting=outdoor,mixed')).not.toContain(e.id);
    expect(await ids('price=free')).toContain(e.id);
    expect(await ids('price=paid')).not.toContain(e.id);
    expect(await ids(`maxKm=${Math.ceil(e.km) + 1}`)).toContain(e.id);
    expect(await ids('maxKm=0.001')).not.toContain(e.id);
    expect((await anon.inject({ url: '/api/catalog?setting=cave' })).statusCode).toBe(400);
  });

  it('propose une Secret Track autour du joueur, pas encore jouée, dans son temps', async () => {
    const e = await published('camille@example.com', {});
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const near = 'lat=43.6085&lng=3.8795';
    const first = (await zoe.get(`/api/catalog/surprise?${near}&minutes=120`)).body;
    expect(first.entry).not.toBeNull();
    expect(first.reasons.length).toBeGreaterThan(0);
    // Trop loin, ou trop court : rien.
    expect((await zoe.get('/api/catalog/surprise?lat=48.85&lng=2.35&radius=5')).body.entry).toBeNull();
    expect((await zoe.get(`/api/catalog/surprise?${near}&minutes=15`)).body.entry).toBeNull();
    // « Une autre » : les versions déjà proposées sont écartées.
    const all = ((await zoe.get('/api/catalog?autonomous=1')).body as { id: number }[]).map((x) => x.id);
    expect((await zoe.get(`/api/catalog/surprise?${near}&exclude=${all.join(',')}`)).body.entry).toBeNull();

    // Une fois jouée jusqu'au bout, elle n'est plus proposée.
    const hunt = (await zoe.post(`/api/catalog/${e.id}/play`)).body;
    await zoe.post(`/api/hunts/${hunt.id}/self-start`);
    const steps = (await ctx.pool.query('SELECT cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order > 0 ORDER BY cod_order', [hunt.id])).rows;
    for (const s of steps) await zoe.post(`/api/hunts/${hunt.id}/checkin`, { lat: s.cod_latitude, lng: s.cod_longitude, accuracy: 5 });
    const others = all.filter((id) => id !== e.id);
    expect((await zoe.get(`/api/catalog/surprise?${near}&exclude=${others.join(',')}`)).body.entry).toBeNull();
    const anon = (await ctx.app.inject({ url: `/api/catalog/surprise?${near}&exclude=${others.join(',')}` })).json();
    expect(anon.entry.id).toBe(e.id);
  });
});
