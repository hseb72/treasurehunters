import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DemoGenerator } from '../src/generation/generator.js';
import { MemoryPhotoStore } from '../src/photos/store.js';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
let app: Awaited<ReturnType<typeof buildApp>>;
const store = new MemoryPhotoStore();

beforeAll(async () => {
  ctx = await setup();
  app = await buildApp(ctx.pool, { generator: new DemoGenerator(), photoStore: store, guide: null, moderator: null });
});
afterAll(async () => {
  await app.close();
  await teardown(ctx);
});

const photo = async () =>
  `data:image/png;base64,${(await sharp({ create: { width: 160, height: 120, channels: 3, background: '#c33' } }).png().toBuffer()).toString('base64')}`;

describe('couverture d’une Secret Track (§ 49)', () => {
  it('la photo du départ devient la couverture, vue par l’organisateur, ses joueurs, et tous si la chasse est publique', async () => {
    const seb = await loginAs(app, 'seb@example.com');
    const job = await seb.post('/api/hunts/generate', {
      location: { query: 'Montpellier', lat: 43.6085, lng: 3.8795 },
      durationMinutes: 45,
      travel: 'walk',
      difficulty: 'easy',
      theme: null,
      steps: 3,
      mode: 'organize',
    });
    await app.service.settle();
    const huntId = (await seb.get(`/api/generations/${job.body.id}`)).body.huntId as number;
    expect((await seb.get(`/api/hunts/${huntId}`)).body.cover).toBe(false);

    const start = (await seb.get(`/api/hunts/${huntId}/steps`)).body.find((s: { order: number }) => s.order === 0);
    expect((await seb.put(`/api/steps/${start.id}/reference-photo`, { image: await photo() })).status).toBe(200);
    expect((await seb.get(`/api/hunts/${huntId}`)).body.cover).toBe(true);
    expect((await seb.get(`/api/hunts/${huntId}/cover`)).status).toBe(200);

    // Chasse privée : ni un autre joueur ni un anonyme ne la voient.
    const camille = await loginAs(app, 'camille@example.com');
    expect((await camille.get(`/api/hunts/${huntId}/cover`)).status).toBe(404);
    await ctx.pool.query('UPDATE th_hunts SET hun_public = true WHERE hun_id = $1', [huntId]);
    expect((await client(app).get(`/api/hunts/${huntId}/cover`)).status).toBe(200);

    // Au catalogue : la couverture suit la version, publique comme sa fiche.
    const entry = await seb.post(`/api/hunts/${huntId}/catalog`, { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null });
    expect(entry.status).toBe(201);
    expect(entry.body.cover).toBe(true);
    const cover = await client(app).get(`/api/catalog/${entry.body.id}/cover`);
    expect(cover.status).toBe(200);
    expect((await sharp(cover.body as Buffer).stats()).dominant.r).toBeGreaterThan(150);
    expect((await client(app).get('/api/catalog')).body.find((e: { id: number }) => e.id === entry.body.id).cover).toBe(true);

    // Retirer la photo du départ : plus de couverture pour la chasse ; la version publiée garde la sienne.
    await seb.del(`/api/steps/${start.id}/reference-photo`);
    expect((await seb.get(`/api/hunts/${huntId}`)).body.cover).toBe(false);
    expect((await client(app).get(`/api/catalog/${entry.body.id}/cover`)).status).toBe(200);

    // Une partie jouée depuis le catalogue reprend la couverture de la version.
    const played = await camille.post(`/api/catalog/${entry.body.id}/play`, {});
    expect(played.status).toBe(201);
    expect((await camille.get(`/api/hunts/${played.body.id}`)).body.cover).toBe(true);
    expect((await camille.get(`/api/hunts/${played.body.id}/cover`)).status).toBe(200);
  });
});

describe('couverture d’une version publiée avant sa photo', () => {
  it('reprend la photo du départ ajoutée ensuite à la chasse d’origine', async () => {
    const zoe = await loginAs(app, 'zoe@example.com');
    const job = await zoe.post('/api/hunts/generate', {
      location: { query: 'Montpellier', lat: 43.62, lng: 3.86 },
      durationMinutes: 45,
      travel: 'walk',
      difficulty: 'easy',
      theme: null,
      steps: 3,
      mode: 'organize',
    });
    await app.service.settle();
    const huntId = (await zoe.get(`/api/generations/${job.body.id}`)).body.huntId as number;
    const entry = await zoe.post(`/api/hunts/${huntId}/catalog`, { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null });
    expect(entry.body.cover).toBe(false);
    expect((await client(app).get(`/api/catalog/${entry.body.id}/cover`)).status).toBe(404);

    const start = (await zoe.get(`/api/hunts/${huntId}/steps`)).body.find((s: { order: number }) => s.order === 0);
    await zoe.put(`/api/steps/${start.id}/reference-photo`, { image: await photo() });
    expect((await client(app).get(`/api/catalog/${entry.body.id}`)).body.cover).toBe(true);
    expect((await client(app).get(`/api/catalog/${entry.body.id}/cover`)).status).toBe(200);
  });
});

describe('stockage des photos en panne', () => {
  it('répond un message clair (503), pas une erreur interne', async () => {
    const broken = new MemoryPhotoStore();
    broken.put = async () => {
      throw new Error('Stockage : dépôt refusé (403) : AccessDenied');
    };
    const down = await buildApp(ctx.pool, { photoStore: broken, guide: null, moderator: null });
    const camille = await loginAs(down, 'camille@example.com');
    const step = (await camille.get('/api/hunts/1/steps')).body.find((s: { order: number }) => s.order === 1);
    const res = await camille.put(`/api/steps/${step.id}/reference-photo`, { image: await photo() });
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('Le stockage des photos refuse l’enregistrement');
    await down.close();
  });
});
