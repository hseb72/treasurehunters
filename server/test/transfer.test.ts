import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HuntFile } from '../../shared/seed.js';
import { pairSteps } from '../src/service.js';
import { STATUS_IDS } from '../src/repo.js';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

/** Un brouillon de Seb, inventé autour de Montpellier (cinq lieux). */
async function draft(seb: Awaited<ReturnType<typeof loginAs>>, at = { query: 'Montpellier', lat: 43.6085, lng: 3.8795 }): Promise<number> {
  const job = await seb.post('/api/hunts/generate', {
    location: at,
    durationMinutes: 45,
    travel: 'walk',
    difficulty: 'easy',
    theme: null,
    steps: 4,
    mode: 'organize',
  });
  await ctx.app.service.settle();
  return (await seb.get(`/api/generations/${job.body.id}`)).body.huntId;
}

/** Réécrit le fichier : nouvelles énigmes, et un lieu de plus avant l'arrivée. */
function rewrite(file: HuntFile): HuntFile {
  const steps = file.steps.map((s, i) => ({ ...s, riddle: i === file.steps.length - 1 ? null : `Suivez les misérables, étape ${i}.` }));
  const extra = { ...steps[1]!, title: 'Lieu ajouté', lat: steps[1]!.lat! + 0.001, riddle: 'Une libération estivale vous guide.', photo: null };
  return { ...file, name: 'Montpellier réécrite', steps: [...steps.slice(0, -1), extra, steps.at(-1)!] };
}

describe('reprise des étapes', () => {
  it('garde départ et arrivée, reprend le milieu dans l’ordre', () => {
    expect(pairSteps(5, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pairSteps(5, 6)).toEqual([0, 1, 2, 3, null, 4]);
    expect(pairSteps(5, 3)).toEqual([0, 1, 4]);
    expect(pairSteps(0, 2)).toEqual([null, null]);
  });
});

describe('export et import JSON d’une chasse', () => {
  it('exporte, puis réécrit sur place une chasse pas encore jouée', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const huntId = await draft(seb);
    const before = (await seb.get(`/api/hunts/${huntId}/steps`)).body as { id: number }[];
    const file = (await seb.get(`/api/hunts/${huntId}/export`)).body as HuntFile;
    expect(file).toMatchObject({ format: 'secrettracks/hunt@1', travel: 'walk', difficulty: 'easy' });
    expect(file.steps).toHaveLength(before.length);
    expect(file.steps[0]!.arrival).toBeNull();
    expect(file.steps.at(-1)!.riddle).toBeNull();

    const next = rewrite(file);
    const preview = await seb.post(`/api/hunts/${huntId}/import?dryRun=1`, next);
    expect(preview.body).toMatchObject({ mode: 'replace', applied: false, huntId, steps: before.length + 1 });
    expect((await seb.get(`/api/hunts/${huntId}`)).body.name).not.toBe('Montpellier réécrite');

    const done = await seb.post(`/api/hunts/${huntId}/import`, next);
    expect(done.body).toMatchObject({ mode: 'replace', applied: true, huntId });
    expect((await seb.get(`/api/hunts/${huntId}`)).body.name).toBe('Montpellier réécrite');
    const after = (await seb.get(`/api/hunts/${huntId}/steps`)).body as { id: number; order: number; title: string; instructions: string | null }[];
    expect(after.map((s) => s.order)).toEqual(after.map((_, i) => i));
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]!.id).toBe(before[0]!.id); // les étapes sont réécrites, pas recréées
    expect(after.at(-1)!.id).toBe(before.at(-1)!.id);
    expect(after.at(-2)!.title).toBe('Lieu ajouté');
    expect(after[1]!.instructions).toBe('Suivez les misérables, étape 1.');

    // Un fichier plus court retire les étapes du milieu en trop.
    const short = { ...next, steps: [next.steps[0]!, next.steps[1]!, next.steps.at(-1)!] };
    await seb.post(`/api/hunts/${huntId}/import`, short);
    expect((await seb.get(`/api/hunts/${huntId}/steps`)).body).toHaveLength(3);
  });

  it('crée une nouvelle version, de la même lignée, d’une chasse déjà jouée', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const huntId = await draft(seb);
    const entry = await seb.post(`/api/hunts/${huntId}/catalog`, { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null });
    expect(entry.status).toBe(201);
    await ctx.pool.query('UPDATE th_hunts SET hun_status_hst = $2 WHERE hun_id = $1', [huntId, STATUS_IDS.closed]);
    const before = (await seb.get(`/api/hunts/${huntId}/steps`)).body;

    const next = rewrite((await seb.get(`/api/hunts/${huntId}/export`)).body);
    expect((await seb.post(`/api/hunts/${huntId}/import?dryRun=1`, next)).body).toMatchObject({ mode: 'copy', applied: false });
    const done = (await seb.post(`/api/hunts/${huntId}/import`, next)).body;
    expect(done).toMatchObject({ mode: 'copy', applied: true });
    expect(done.huntId).not.toBe(huntId);
    expect(done.warnings[0]).toMatch(/nouvelle version/);

    // L'ancienne est intacte ; la nouvelle est un brouillon de Seb, rattaché à la version publiée.
    expect((await seb.get(`/api/hunts/${huntId}/steps`)).body).toEqual(before);
    const copy = (await seb.get(`/api/hunts/${done.huntId}`)).body;
    expect(copy).toMatchObject({ name: 'Montpellier réécrite', status: 'draft', validation: 'geo', catalogId: entry.body.id });
    expect((await seb.get(`/api/hunts/${done.huntId}/steps`)).body).toHaveLength(before.length + 1);
    const v2 = await seb.post(`/api/hunts/${done.huntId}/catalog`, { summary: 'Balade réécrite.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 1, changes: 'Énigmes réécrites.' });
    expect(v2.status).toBe(201);
    const parent = (await ctx.pool.query('SELECT cat_parent_cat FROM th_catalog WHERE cat_id = $1', [v2.body.id])).rows[0].cat_parent_cat;
    expect(parent).toBe(entry.body.id);
  });

  it('laisse le joueur d’une partie finie exporter le parcours et en faire sa copie', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const source = await draft(seb, { query: 'Lyon', lat: 45.764, lng: 4.8357 });
    const entry = (await seb.post(`/api/hunts/${source}/catalog`, { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null })).body;
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const hunt = (await zoe.post(`/api/catalog/${entry.id}/play`)).body;
    expect((await zoe.get(`/api/hunts/${hunt.id}/export`)).status).toBe(403); // parcours encore secret
    await zoe.post(`/api/hunts/${hunt.id}/self-start`);
    const steps = (await ctx.pool.query('SELECT cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order > 0 ORDER BY cod_order', [hunt.id])).rows;
    for (const s of steps) await zoe.post(`/api/hunts/${hunt.id}/checkin`, { lat: s.cod_latitude, lng: s.cod_longitude, accuracy: 5 });

    const file = (await zoe.get(`/api/hunts/${hunt.id}/export`)).body;
    expect(file.steps).toHaveLength(steps.length + 1);
    const done = (await zoe.post(`/api/hunts/${hunt.id}/import`, rewrite(file))).body;
    expect(done.mode).toBe('copy');
    const copy = (await zoe.get(`/api/hunts/${done.huntId}`)).body;
    expect(copy).toMatchObject({ status: 'draft', surprise: false, catalogId: null });
    expect((await client(ctx.app).get(`/api/hunts/${done.huntId}/export`)).status).toBe(401);
    expect((await seb.get(`/api/hunts/${done.huntId}/export`)).status).toBe(403);
  });

  it('refuse un fichier illisible, sans rien changer', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const huntId = await draft(seb);
    const r = await seb.post(`/api/hunts/${huntId}/import`, { format: 'autre', steps: [] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Fichier illisible/);
  });
});
