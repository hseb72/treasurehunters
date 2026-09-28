import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

type Item = { id: string; owned: boolean; included: boolean; price: number };
const item = (list: Item[], id: string) => list.find((i) => i.id === id)!;

describe('boutique', () => {
  it('présente univers et outils, avec leur prix, et ce que chacun possède', async () => {
    const list = (await client(ctx.app).get('/api/store')).body as Item[];
    expect(item(list, 'skin:aventure')).toMatchObject({ included: true, owned: true, price: 0 });
    expect(item(list, 'skin:medieval')).toMatchObject({ included: false, owned: false, price: 299 });
    expect(item(list, 'tool:compass')).toMatchObject({ included: false, owned: false });
    expect(item(list, 'tool:live')).toMatchObject({ included: true, owned: true });
    expect((await client(ctx.app).post('/api/store/skin:medieval/acquire')).status).toBe(401);
  });

  it('n’installe sur une chasse que les extensions obtenues, offertes pour l’instant', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com'); // organisateur de la chasse 4 (brouillon)
    const refused = await seb.patch('/api/hunts/4', { skin: 'medieval' });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Médiéval.*boutique/);
    expect((await seb.patch('/api/hunts/4', { tools: ['live', 'compass'] })).status).toBe(403);
    expect((await seb.post('/api/store/skin:nimporte/acquire')).status).toBe(400);

    const after = (await seb.post('/api/store/skin:medieval/acquire')).body as Item[];
    expect(item(after, 'skin:medieval').owned).toBe(true);
    await seb.post('/api/store/skin:medieval/acquire'); // une seconde fois : sans effet
    expect((await ctx.pool.query(`SELECT pur_price FROM th_purchases WHERE pur_product = 'skin:medieval'`)).rows).toEqual([{ pur_price: 0 }]);
    expect((await seb.patch('/api/hunts/4', { skin: 'medieval' })).body.skin).toBe('medieval');
    // Ce que la chasse a déjà reste permis, même sans l'avoir obtenu (ici : l'univers d'origine).
    expect((await seb.patch('/api/hunts/4', { name: 'Mystères de l’Écusson', skin: 'medieval' })).status).toBe(200);
  });
});

describe('outils de jeu', () => {
  it('boussole, carte et position en direct, selon les outils installés', async () => {
    const tom = await loginAs(ctx.app, 'tom@example.com');
    const started = await tom.post('/api/hunts/generate', {
      location: { query: 'Montpellier', lat: 43.6085, lng: 3.8795 },
      durationMinutes: 45,
      travel: 'walk',
      difficulty: 'medium',
      theme: null,
      steps: null,
      mode: 'organize',
    });
    await ctx.app.service.settle();
    const huntId = (await tom.get(`/api/generations/${started.body.id}`)).body.huntId;
    expect((await tom.get(`/api/hunts/${huntId}`)).body.tools).toEqual(['live']);
    await tom.post('/api/store/tool:map/acquire');
    await tom.post('/api/store/tool:compass/acquire');
    expect((await tom.patch(`/api/hunts/${huntId}`, { tools: ['map', 'compass', 'map'] })).body.tools).toEqual(['map', 'compass']);
    // Une chasse inventée ensuite reçoit d'office les outils du joueur.
    const next = await tom.post('/api/hunts/generate', { location: { query: 'Lattes', lat: 43.57, lng: 3.9 }, durationMinutes: 30, travel: 'walk', difficulty: 'easy', theme: null, steps: null, mode: 'play' });
    await ctx.app.service.settle();
    const surprise = (await tom.get(`/api/generations/${next.body.id}`)).body.huntId;
    expect((await tom.get(`/api/hunts/${surprise}`)).body.tools).toEqual(['live', 'map', 'compass']);
    await tom.post(`/api/hunts/${huntId}/publish`);

    const lea = await loginAs(ctx.app, 'lea@example.com');
    await lea.post(`/api/hunts/${huntId}/teams`, { name: 'Boussole' });
    await tom.post(`/api/hunts/${huntId}/start`);
    const steps = (await tom.get(`/api/hunts/${huntId}/steps`)).body;
    const start = { lat: steps[0].latitude, lng: steps[0].longitude };

    // Boussole : une direction et une fourchette, jamais les coordonnées.
    const reading = (await lea.post(`/api/hunts/${huntId}/compass`, start)).body;
    expect(reading).toEqual({ bearing: expect.any(Number), direction: expect.any(String), band: expect.any(String) });
    expect(reading.bearing % 45).toBe(0);
    expect(JSON.stringify(reading)).not.toContain(String(steps[1].latitude));

    // Carte : les lieux trouvés seulement. Position en direct : retirée avec l'outil.
    let state = (await lea.get(`/api/hunts/${huntId}/play`)).body;
    expect(state).toMatchObject({ trail: [], position: null });
    state = (await lea.post(`/api/hunts/${huntId}/checkin`, { lat: steps[1].latitude, lng: steps[1].longitude, accuracy: 5 })).body.state;
    expect(state.trail).toEqual([{ order: 1, title: steps[1].title, lat: steps[1].latitude, lng: steps[1].longitude }]);

    // Sans l'outil, pas de boussole.
    const other = await loginAs(ctx.app, 'seb@example.com');
    expect((await other.post('/api/hunts/1/compass', start)).status).toBe(403);
  });
});
