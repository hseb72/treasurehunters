import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenerationRequest } from '../../shared/models.js';
import { buildApp } from '../src/app.js';
import { toHuntPlan } from '../src/generation/claude.js';
import { HttpError } from '../src/errors.js';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

const request = (mode: GenerationRequest['mode']): GenerationRequest => ({
  location: { query: 'Montpellier', lat: 43.6085, lng: 3.8795 },
  durationMinutes: 45,
  difficulty: 'medium',
  steps: null,
  mode,
});

async function generate(api: Awaited<ReturnType<typeof loginAs>>, mode: GenerationRequest['mode']) {
  const started = await api.post('/api/hunts/generate', request(mode));
  expect(started.status).toBe(202);
  expect(started.body).toMatchObject({ status: 'pending', mode, huntId: null });
  await ctx.app.service.settle();
  return (await api.get(`/api/generations/${started.body.id}`)).body;
}

describe('chasse surprise (mode « je joue »)', () => {
  it('invente une chasse cachée que le joueur lance et termine seul', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const job = await generate(seb, 'play');
    expect(job.status).toBe('done');

    const hunt = (await seb.get(`/api/hunts/${job.huntId}`)).body;
    expect(hunt).toMatchObject({ ownerNickname: 'Treasure Hunters', status: 'published', surprise: true, generated: true, validation: 'geo', isPublic: false });
    expect(hunt.stepCount).toBe(4); // 45 min / 12 min par étape
    expect((await seb.get(`/api/hunts/${job.huntId}/steps`)).status).toBe(403); // le parcours reste secret

    const before = (await seb.get(`/api/hunts/${job.huntId}/play`)).body;
    expect(before).toMatchObject({ selfStart: true, clue: null });
    const started = (await seb.post(`/api/hunts/${job.huntId}/self-start`)).body;
    expect(started.selfStart).toBe(false);
    expect(started.clue.targetOrder).toBe(1);

    const steps = (await ctx.pool.query('SELECT cod_order, cod_latitude, cod_longitude FROM th_codes WHERE cod_hunt_hun = $1 AND cod_order > 0 ORDER BY cod_order', [job.huntId])).rows;
    let last;
    for (const s of steps) {
      last = (await seb.post(`/api/hunts/${job.huntId}/checkin`, { lat: s.cod_latitude, lng: s.cod_longitude, accuracy: 8 })).body;
      expect(last.outcome).toBe('validated');
    }
    expect(last.step.isFinal).toBe(true);
    expect(last.state.hunt.status).toBe('closed'); // seul joueur arrivé : la chasse se clôt
    expect((await seb.get(`/api/hunts/${job.huntId}/results`)).body[0]).toMatchObject({ rank: 1, teamName: 'seb' });
  });

  it('ne laisse personne se connecter avec le compte système', async () => {
    const res = await client(ctx.app).post('/api/auth/register', { nickname: 'pirate', email: 'generateur@treasurehunters.invalid', password: '12345678' });
    expect(res.status).toBe(400);
  });
});

describe('chasse générée à organiser', () => {
  it('crée un brouillon géolocalisé dont le joueur devient l’organisateur', async () => {
    const camille = await loginAs(ctx.app, 'camille@example.com');
    const job = await generate(camille, 'organize');
    const hunt = (await camille.get(`/api/hunts/${job.huntId}`)).body;
    expect(hunt).toMatchObject({ ownerId: expect.any(Number), status: 'draft', surprise: false, generated: true, validation: 'geo', teamGame: true });
    expect(hunt.ownerNickname).not.toBe('Treasure Hunters');
    const steps = (await camille.get(`/api/hunts/${job.huntId}/steps`)).body;
    expect(steps[0]).toMatchObject({ order: 0, title: 'Départ', token: null });
    expect(steps.every((s: { latitude: number | null }) => s.latitude !== null)).toBe(true);
    expect(steps.at(-1).instructions).toBeNull();
    expect((await camille.post(`/api/hunts/${job.huntId}/publish`)).body.status).toBe('published');
  });
});

describe('limites de la génération', () => {
  it('applique un quota quotidien par joueur, sans compter les échecs', async () => {
    const lea = await loginAs(ctx.app, 'lea@example.com');
    const id = (await ctx.pool.query(`SELECT htr_id FROM th_hunters WHERE htr_email = 'lea@example.com'`)).rows[0].htr_id;
    const add = (status: string, n: number) =>
      ctx.pool.query(
        `INSERT INTO th_generations (gen_hunter_htr, gen_status, gen_params) SELECT $1, $2, '{"mode":"play"}' FROM generate_series(1, $3::int)`,
        [id, status, n],
      );
    await add('error', 5);
    await add('done', 4);
    const fifth = await lea.post('/api/hunts/generate', request('play')); // 4 réussies + 5 échecs : encore permis
    expect(fifth.status).toBe(202);
    await ctx.app.service.settle();
    const res = await lea.post('/api/hunts/generate', request('play'));
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/5 chasses/);
  });

  it('plafonne aussi les essais qui échouent', async () => {
    const lucas = await loginAs(ctx.app, 'lucas@example.com');
    const id = (await ctx.pool.query(`SELECT htr_id FROM th_hunters WHERE htr_email = 'lucas@example.com'`)).rows[0].htr_id;
    await ctx.pool.query(
      `INSERT INTO th_generations (gen_hunter_htr, gen_status, gen_params) SELECT $1, 'error', '{"mode":"play"}' FROM generate_series(1, 20)`,
      [id],
    );
    const res = await lucas.post('/api/hunts/generate', request('play'));
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/Trop d’essais/);
  });

  it('refuse une demande sans lieu et cache les générations des autres', async () => {
    const hugo = await loginAs(ctx.app, 'hugo@example.com');
    expect((await hugo.post('/api/hunts/generate', { ...request('play'), location: {} })).status).toBe(400);
    const job = (await ctx.pool.query(`SELECT gen_id FROM th_generations LIMIT 1`)).rows[0].gen_id;
    expect((await hugo.get(`/api/generations/${job}`)).status).toBe(404);
  });

  it('rend compte d’un échec et d’un serveur sans générateur', async () => {
    const failing = await buildApp(ctx.pool, {
      generator: { generate: async () => Promise.reject(new HttpError(422, 'Pas assez de lieux remarquables autour de ce point.')) },
    });
    const nathan = await loginAs(failing, 'nathan@example.com');
    const started = await nathan.post('/api/hunts/generate', request('play'));
    await failing.service.settle();
    expect((await nathan.get(`/api/generations/${started.body.id}`)).body).toMatchObject({ status: 'error', error: expect.stringMatching(/lieux/) });

    const disabled = await buildApp(ctx.pool, { generator: null });
    expect((await (await loginAs(disabled, 'nathan@example.com')).post('/api/hunts/generate', request('play'))).status).toBe(503);
    await Promise.all([failing.close(), disabled.close()]);
  });
});

describe('réponse du modèle', () => {
  const poi = (id: string, lat: number) => ({ id, name: `Lieu ${id}`, kind: 'fountain', lat, lng: 3.88, details: {} });
  const place = (poiId: string) => ({ poiId, title: `Étape ${poiId}`, riddle: `Énigme vers ${poiId}`, hints: ['a', 'b', 'c', 'd'], arrival: `Bravo ${poiId}` });
  const input = { placeName: 'Montpellier', center: { lat: 43.6, lng: 3.88 }, pois: [poi('n1', 43.601), poi('n2', 43.602), poi('n3', 43.603)], count: 3, difficulty: 'easy' as const, durationMinutes: 30 };

  it('enchaîne les énigmes et reprend les coordonnées d’OpenStreetMap', () => {
    const plan = toHuntPlan({ name: 'N', description: 'D', startText: 'S', award: 'A', places: [place('n2'), place('n1'), place('n3')] }, input);
    expect(plan.steps.map((s) => s.instructions)).toEqual(['Énigme vers n2', 'Énigme vers n1', 'Énigme vers n3', null]);
    expect(plan.steps[1]).toMatchObject({ latitude: 43.602, address: 'Lieu n2', arrival: 'Bravo n2' });
    expect(plan.steps[0].hints).toHaveLength(3);
    expect(plan.steps[3].hints).toEqual([]);
  });

  it('écarte les lieux inventés ou répétés', () => {
    const places = [place('n1'), place('x9'), place('n1'), place('n2')];
    expect(() => toHuntPlan({ name: 'N', description: 'D', startText: 'S', award: '', places }, input)).toThrow(/incomplète/);
  });
});
