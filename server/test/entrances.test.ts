import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { demoPlan } from '../../shared/generation.js';
import { distanceMeters } from '../../shared/rules.js';
import { placeAtEntrances } from '../src/generation/generator.js';
import { accessOf, Poi } from '../src/generation/osm.js';
import { Ctx, loginAs, setup, teardown } from './helpers.js';

const poi = (id: string, lat: number, lng: number): Poi => ({ id, name: id, kind: 'park', lat, lng, details: {}, themed: false, gated: true });

describe('entrées des lieux clos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lit les entrées d’un parc, le contour d’un musée sans entrée, et laisse les petits lieux', async () => {
    // Parc (w1) de ~400 m avec deux portails et une issue privée ; musée ponctuel (n5) dans un
    // bâtiment (w2) de ~80 m sans entrée ; fontaine (w3) de 10 m.
    const square = (id: number, lat: number, lng: number, half: number, nodes: number[]) => ({
      type: 'way',
      id,
      nodes,
      geometry: [
        [lat - half, lng - half],
        [lat - half, lng + half],
        [lat + half, lng + half],
        [lat + half, lng - half],
        [lat - half, lng - half],
      ].map(([a, b]) => ({ lat: a, lon: b })),
    });
    const elements = [
      square(1, 43.6, 3.88, 0.002, [11, 12, 13, 14, 11]),
      { ...square(2, 43.61, 3.89, 0.0004, [21, 22, 23, 24, 21]), tags: { building: 'yes' } },
      square(3, 43.62, 3.9, 0.00005, [31, 32, 33, 34, 31]),
      { type: 'node', id: 11, lat: 43.598, lon: 3.878, tags: { entrance: 'main' } },
      { type: 'node', id: 13, lat: 43.602, lon: 3.882, tags: { barrier: 'gate' } },
      // Portail sur la clôture, à 10 m du contour du parc : accepté.
      { type: 'node', id: 99, lat: 43.6, lon: 3.8821, tags: { barrier: 'gate' } },
      // Porte d'un bâtiment voisin, à 10 m du musée mais pas sur son contour : ignorée.
      { type: 'node', id: 98, lat: 43.6105, lon: 3.8905, tags: { entrance: 'yes' } },
    ];
    const fetch = vi.fn(async () => new Response(JSON.stringify({ elements }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const access = await accessOf([poi('w1', 43.6, 3.88), poi('n5', 43.61, 3.89), poi('w3', 43.62, 3.9)]);
    const query = decodeURIComponent(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(query).toContain('way(id:1,3)');
    expect(query).toContain('node(id:5)');

    expect(access.get('w1')).toEqual({ entrances: true, points: [{ lat: 43.598, lng: 3.878 }, { lat: 43.602, lng: 3.882 }, { lat: 43.6, lng: 3.8821 }] });
    expect(access.get('n5')).toMatchObject({ entrances: false });
    expect(access.get('n5')!.points.length).toBe(4); // les coins du bâtiment, le dernier fermant le contour
    expect(access.has('w3')).toBe(false);
  });

  it('place l’étape à l’entrée par laquelle on arrive, les autres restant valables', () => {
    const plan = demoPlan({ lat: 43.6, lng: 3.88 }, 3);
    plan.steps[2].source = 'w1';
    const prev = plan.steps[1];
    const near = { lat: prev.latitude + 0.0005, lng: prev.longitude };
    const far = { lat: prev.latitude + 0.01, lng: prev.longitude };
    const placed = placeAtEntrances(plan, new Map([['w1', { entrances: true, points: [far, near] }]]));
    expect(placed.steps[2]).toMatchObject({ latitude: near.lat, longitude: near.lng, entrances: [far] });
    expect(placed.steps[1]).toEqual(plan.steps[1]);
    expect(plan.steps[2].entrances).toBeUndefined(); // le plan d'origine n'est pas modifié
  });
});

describe('validation depuis une entrée', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));

  it('valide depuis n’importe quelle entrée, et oublie les entrées si l’organisateur déplace l’étape', async () => {
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
    const step = (await tom.get(`/api/hunts/${huntId}/steps`)).body[1];
    const gate = { lat: step.latitude + 0.003, lng: step.longitude }; // ~330 m du point du lieu
    await ctx.pool.query('UPDATE th_codes SET cod_entrances = $2 WHERE cod_id = $1', [step.id, JSON.stringify([gate])]);
    expect((await tom.get(`/api/hunts/${huntId}/steps`)).body[1].entrances).toEqual([gate]);

    // Un joueur, parti, arrive par le portail.
    await tom.post(`/api/hunts/${huntId}/publish`);
    const lea = await loginAs(ctx.app, 'lea@example.com');
    await lea.post(`/api/hunts/${huntId}/teams`, { name: 'Portail' });
    expect((await tom.post(`/api/hunts/${huntId}/start`)).body.status).toBe('running');
    const res = (await lea.post(`/api/hunts/${huntId}/checkin`, { ...gate, accuracy: 5 })).body;
    expect(distanceMeters(gate, { lat: step.latitude, lng: step.longitude })).toBeGreaterThan(300);
    expect(res).toMatchObject({ outcome: 'validated', distance: 0 });

    // Changer le titre garde les entrées ; déplacer l'étape les efface.
    await ctx.pool.query(`UPDATE th_hunts SET hun_status_hst = (SELECT hst_id FROM th_huntstatus WHERE hst_code = 'draft') WHERE hun_id = $1`, [huntId]);
    expect((await tom.patch(`/api/steps/${step.id}`, { title: 'Le parc' })).body.entrances).toEqual([gate]);
    expect((await tom.patch(`/api/steps/${step.id}`, { latitude: step.latitude, longitude: step.longitude })).body.entrances).toEqual([gate]);
    expect((await tom.patch(`/api/steps/${step.id}`, { latitude: gate.lat, longitude: gate.lng })).body.entrances).toEqual([]);
  });
});
