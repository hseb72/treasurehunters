import { createServer, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { nearbyQuery, OsmNearby } from '../src/nearby.js';
import { hoursLabel, nearbyKind } from '../../shared/nearby.js';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

/** Faux Overpass : répond selon un scénario, dans l'ordre des requêtes. */
let server: Server;
let script: ((res: ServerResponse) => void)[] = [];
const bodies: string[] = [];
const ok = (elements: unknown[]) => (res: ServerResponse) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ elements }));
const down = (res: ServerResponse) => res.writeHead(400).end('bad request');

let ctx: Ctx;
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      bodies.push(decodeURIComponent(body.replace(/^data=/, '')));
      (script.shift() ?? ok([]))(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  config.overpassUrls = [`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`];
  ctx = await setup();
});
afterAll(async () => {
  await teardown(ctx);
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  script = [];
  bodies.length = 0;
});

const here = { lat: 43.6, lng: 3.88 };
/** Point à `m` mètres au nord. */
const north = (m: number) => ({ lat: here.lat + m / 111_195, lon: here.lng });
const node = (id: number, m: number, tags: Record<string, string>) => ({ type: 'node', id, ...north(m), tags });

describe('Autour de moi : OpenStreetMap', () => {
  it('classe les lieux par catégorie et par distance, avec les toilettes sans nom', async () => {
    script = [
      ok([
        node(1, 300, { name: 'Glacier Pinguino', amenity: 'ice_cream', opening_hours: 'Mo-Sa 10:00-19:30; Su off' }),
        node(2, 80, { name: 'Boulangerie du Coin', shop: 'bakery', 'addr:housenumber': '3', 'addr:street': 'rue Foch' }),
        node(3, 120, { amenity: 'toilets' }),
        node(4, 150, { amenity: 'toilets', access: 'customers' }),
        node(5, 200, { name: 'Run & Co', shop: 'shoes' }),
        node(6, 2000, { name: 'Trop loin', amenity: 'cafe' }),
        node(2, 80, { name: 'Boulangerie du Coin', shop: 'bakery' }), // en double : deux jeux de résultats
      ]),
    ];
    const r = await new OsmNearby().find(here, 500);
    expect(r.places.map((p) => [p.id, p.category])).toEqual([
      ['n2', 'snack'],
      ['n3', 'toilets'],
      ['n5', 'shops'],
      ['n1', 'snack'],
    ]);
    expect(r.places[0]).toMatchObject({ name: 'Boulangerie du Coin', kind: 'Boulangerie', distance: 80, address: '3 rue Foch' });
    expect(r.places[1]).toMatchObject({ name: null, kind: 'Toilettes' });
    expect(r.places[3].hours).toBe('lun-sam 10h-19h30 · dim fermé');
    expect(r.categories.map((c) => c.id)).toEqual(['snack', 'food', 'shops', 'toilets', 'pharmacy', 'water', 'playground']);
    expect(bodies[0]).toContain('[bbox:');
  });

  it('place les centres d’intérêt en premier : les chaussures y vont plutôt que dans « Boutiques »', async () => {
    script = [ok([node(5, 200, { name: 'Run & Co', shop: 'shoes' }), node(7, 250, { name: 'Mode', shop: 'clothes' })])];
    const r = await new OsmNearby().find(here, 500, [{ label: 'Sneakers', filters: [{ key: 'shop', values: ['shoes', 'sports'] }] }]);
    expect(r.categories[0]).toEqual({ id: 'interest-0', label: 'Sneakers', icon: 'favorite' });
    expect(r.places.map((p) => p.category)).toEqual(['interest-0', 'shops']);
    expect(bodies[0]).toContain('nw[shop~"^(shoes|sports)$"][name]');
  });

  it('écarte les filtres dangereux des centres d’intérêt', async () => {
    script = [ok([])];
    const r = await new OsmNearby().find(here, 500, [{ label: 'Piège', filters: [{ key: 'shop', values: ['x"];out;'] }, { key: 'evil', values: null }] }]);
    expect(r.categories[0].id).toBe('snack');
    expect(bodies[0]).not.toContain('evil');
    expect(bodies[0]).not.toContain('x"]');
    expect(nearbyQuery(here, 500, []).categories).toHaveLength(7);
  });

  it('garde la réponse en cache pour les joueurs voisins, mais pas un échec', async () => {
    const finder = new OsmNearby();
    script = [down];
    await expect(finder.find(here, 500)).rejects.toThrow(/OpenStreetMap/);
    script = [ok([node(1, 100, { name: 'Café', amenity: 'cafe' })])];
    const a = await finder.find(here, 500);
    const b = await finder.find({ lat: here.lat + 0.0002, lng: here.lng }, 500); // 20 m plus loin, même case
    expect(bodies).toHaveLength(2);
    expect(a.places[0].distance).toBe(100);
    expect(b.places[0].distance).toBe(78);
  });

  it('traduit les horaires et la nature des lieux', () => {
    expect(hoursLabel('24/7')).toBe('Ouvert 24 h/24');
    expect(hoursLabel('Tu-Fr 08:30-12:00,14:00-18:00; PH off')).toBe('mar-ven 8h30-12h, 14h-18h · fériés fermé');
    expect(hoursLabel('')).toBeNull();
    expect(nearbyKind({ shop: 'weird_shop' }, 'X')).toBe('Boutique');
    expect(nearbyKind({}, 'Lieu')).toBe('Lieu');
  });
});

describe('Autour de moi : API', () => {
  it('demande d’être connecté et une position valide', async () => {
    expect((await client(ctx.app).post('/api/nearby', here)).status).toBe(401);
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.post('/api/nearby', { lat: 120, lng: 3 })).status).toBe(400);
    expect((await seb.post('/api/nearby', { ...here, radius: 50_000 })).status).toBe(400);
  });

  it('renvoie les adresses autour du joueur', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    script = [ok([node(9, 60, { name: 'Pharmacie Centrale', amenity: 'pharmacy' })])];
    const res = await seb.post('/api/nearby', { lat: 43.7, lng: 3.9, radius: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.radius).toBe(1000);
    expect(res.body.places).toEqual([]); // le lieu est à côté de `here`, pas de ce point
    script = [ok([node(9, 60, { name: 'Pharmacie Centrale', amenity: 'pharmacy' })])];
    const near = await seb.post('/api/nearby', { ...here, radius: 1000 });
    expect(near.body.places[0]).toMatchObject({ name: 'Pharmacie Centrale', category: 'pharmacy', distance: 60 });
  });
});
