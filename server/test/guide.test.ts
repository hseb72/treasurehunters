import { createServer, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { assemble } from '../src/guide/guide.js';
import { buildApp } from '../src/app.js';
import { demoUnderstanding, GUIDE_WHERE_QUESTION, playMinutesOf, rankProposals } from '../../shared/guide.js';
import { CatalogEntry } from '../../shared/models.js';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let server: Server;
let reply: unknown[] = [];
const bodies: string[] = [];
let ctx: Ctx;
beforeAll(async () => {
  server = createServer((req, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      bodies.push(decodeURIComponent(body.replace(/^data=/, '')));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ elements: reply }));
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

const EXAMPLE = 'On est en vacances en famille avec 2 enfants et on souhaite visiter la ville cet après-midi en mode ballade. Prévois une pause intermédiaire pour le goûter.';

describe('guide : compréhension', () => {
  it('retire le temps réservé de la durée du parcours', () => {
    expect(playMinutesOf(120, [{ activity: 'le goûter', minutes: 30 }])).toBe(90);
    expect(playMinutesOf(60, [{ activity: 'le déjeuner', minutes: 60 }])).toBe(30); // jamais sous 30 min
  });

  it('comprend l’exemple par mots-clés, et demande le lieu sans position', () => {
    const u = demoUnderstanding({ text: EXAMPLE, position: { lat: 43.6, lng: 3.88 } });
    expect(u).toMatchObject({ travel: 'walk', difficulty: 'easy', audience: 'family', totalMinutes: 180, playMinutes: 150, place: null, question: null });
    expect(u.reserved).toEqual([{ activity: 'le goûter', minutes: 30 }]);
    expect(u.summary).toBe('Je vous prévois 2 heures 30 de balade à pied autour de vous. Il vous restera 30 minutes pour le goûter.');
    expect(demoUnderstanding({ text: EXAMPLE, position: null }).question).toBe(GUIDE_WHERE_QUESTION);
  });

  it('borne et filtre ce que répond l’IA', () => {
    const u = assemble(
      { text: 'x', position: null },
      {
        place: ' Montpellier ',
        total_minutes: 2000,
        reserved: [
          { activity: 'le shopping', minutes: 45 },
          { activity: '', minutes: 10 },
        ],
        travel: 'walk',
        difficulty: 'medium',
        audience: 'friends',
        youngest_age: -3,
        theme: null,
        interests: [
          { label: 'Sneakers', filters: [{ key: 'shop', values: ['shoes', 'sports"];'] }] },
          { label: 'Rien', filters: [] },
        ],
      },
    );
    expect(u).toMatchObject({ place: 'Montpellier', totalMinutes: 480, playMinutes: 435, youngestAge: null, question: null });
    expect(u.reserved).toHaveLength(1);
    expect(u.interests).toEqual([{ label: 'Sneakers', filters: [{ key: 'shop', values: ['shoes'] }] }]);
    expect(u.summary).toContain('le bouton « Autour » vous montrera : Sneakers');
  });

  it('classe les propositions du catalogue', () => {
    const entry = (id: number, over: Partial<CatalogEntry>) =>
      ({ id, withdrawn: false, difficulty: 'medium', audience: [], minAge: null, durationMinutes: 90, distanceKm: 1, rating: { stars: null }, ...over }) as CatalogEntry;
    const u = { ...demoUnderstanding({ text: EXAMPLE, position: { lat: 0, lng: 0 } }), youngestAge: 6 };
    const ranked = rankProposals(
      [entry(1, { minAge: 12 }), entry(2, { difficulty: 'easy', audience: ['family'], durationMinutes: 150 }), entry(3, { withdrawn: true }), entry(4, {})],
      u,
    );
    expect(ranked.map((e) => e.id)).toEqual([2, 4, 1]);
  });
});

describe('guide : API', () => {
  it('répond à un joueur connecté', async () => {
    expect((await client(ctx.app).post('/api/guide', { text: EXAMPLE })).status).toBe(401);
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.post('/api/guide', { text: 'a' })).status).toBe(400);
    const res = await seb.post('/api/guide', { text: EXAMPLE, position: { lat: 43.6, lng: 3.88 } });
    expect(res.status).toBe(200);
    expect(res.body.playMinutes).toBe(150);
    expect((await seb.get('/api/features')).body.guide).toBe(true);
  });

  it('est indisponible sans IA', async () => {
    const app = await buildApp(ctx.pool, { guide: null, generator: null });
    const seb = await loginAs(app, 'seb@example.com');
    expect((await seb.post('/api/guide', { text: EXAMPLE })).status).toBe(503);
    await app.close();
  });

  it('enregistre les centres d’intérêt de l’équipe et les place en tête d’« Autour de moi »', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const job = await seb.post('/api/hunts/generate', {
      location: { query: 'Montpellier', lat: 43.6085, lng: 3.8795 },
      durationMinutes: 45,
      travel: 'walk',
      difficulty: 'easy',
      theme: null,
      steps: 3,
      mode: 'play',
    });
    await ctx.app.service.settle();
    const huntId = (await seb.get(`/api/generations/${job.body.id}`)).body.huntId as number;

    const saved = await seb.put(`/api/hunts/${huntId}/interests`, {
      interests: [{ label: 'Sneakers', filters: [{ key: 'shop', values: ['shoes', 'bad value!'] }] }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual([{ label: 'Sneakers', filters: [{ key: 'shop', values: ['shoes'] }] }]);

    reply = [{ type: 'node', id: 5, lat: 43.6086, lon: 3.8795, tags: { name: 'Run & Co', shop: 'shoes' } }];
    const near = await seb.post('/api/nearby', { lat: 43.6085, lng: 3.8795, radius: 500, huntId });
    expect(near.body.categories[0]).toEqual({ id: 'interest-0', label: 'Sneakers', icon: 'favorite' });
    expect(near.body.places[0]).toMatchObject({ name: 'Run & Co', category: 'interest-0' });
    expect(bodies.at(-1)).toContain('nw[shop~"^(shoes)$"][name]');

    const other = await loginAs(ctx.app, 'camille@example.com');
    expect((await other.put(`/api/hunts/${huntId}/interests`, { interests: [] })).status).toBe(404);
  });
});
