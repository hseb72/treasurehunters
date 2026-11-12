import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SeedHunt } from '../../shared/seed.js';
import { checkSeed } from '../src/seed/validate.js';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

const example = (): SeedHunt => JSON.parse(readFileSync(new URL('./fixtures/seed-example.json', import.meta.url), 'utf8'));

describe('contrôle des parcours d’initialisation', () => {
  it('accepte un parcours complet', () => {
    expect(checkSeed(example()).errors).toEqual([]);
  });

  it('refuse un fichier mal formé', () => {
    const r = checkSeed({ ...example(), key: 'Pas Une Clé', steps: [] });
    expect(r.seed).toBeNull();
    expect(r.errors.join(' ')).toMatch(/key/);
  });

  it('refuse un nom de plus de 50 caractères, comme pour une chasse', () => {
    expect(checkSeed({ ...example(), name: 'x'.repeat(50) }).errors).toEqual([]);
    const r = checkSeed({ ...example(), name: 'x'.repeat(51) });
    expect(r.seed).toBeNull();
    expect(r.errors.join(' ')).toMatch(/name/);
  });

  it('signale ce qui rendrait le parcours injouable', () => {
    const s = example();
    s.steps[1]!.hints = ['un seul'];
    delete s.steps[2]!.arrival;
    s.steps[2]!.riddle = 'Allez au Jardin des plantes.'; // nomme le lieu suivant
    s.steps[3]!.lat = 43.7; // ~10 km : trop loin à pied
    s.steps[3]!.riddle = 'Encore ?';
    const errors = checkSeed(s).errors.join('\n');
    expect(errors).toMatch(/trois jokers/);
    expect(errors).toMatch(/message d'arrivée/);
    expect(errors).toMatch(/contient « plantes »/);
    expect(errors).toMatch(/trop loin/);
    expect(errors).toMatch(/pas d'énigme après l'arrivée/);
  });

  it('accepte des épreuves d’arrivée bien rédigées, jamais au départ', () => {
    const s = example();
    s.steps[1]!.puzzle = { type: 'lock', prompt: 'L’année gravée sur l’arc ?', answer: '1691' };
    s.steps[3]!.puzzle = { type: 'anagram', prompt: 'Remettez les lettres dans l’ordre.', answer: 'botanique' };
    expect(checkSeed(s).errors).toEqual([]);
    s.steps[0]!.puzzle = { type: 'question', prompt: 'Combien de Grâces ?', answer: '3' };
    s.steps[2]!.puzzle = { type: 'cipher', prompt: 'Déchiffrez.', answer: 'roi soleil' }; // sans décalage
    const errors = checkSeed(s).errors.join('\n');
    expect(errors).toMatch(/pas d'épreuve d'arrivée au départ/);
    expect(errors).toMatch(/décalage/);
  });
});

describe('import des parcours d’initialisation', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));

  it('crée la Secret Track sous le compte SecretTracks, la partage marquée, sans la dupliquer', async () => {
    const seed = checkSeed(example()).seed!;
    const first = await ctx.app.service.importSeed(seed);
    expect(first.status).toBe('imported');
    // Sans stockage de photos configuré, rien à signaler : le parcours n'a pas de photo.
    expect(first.warnings).toEqual([]);

    const entry = (await client(ctx.app).get(`/api/catalog/${first.catalogId}`)).body;
    expect(entry).toMatchObject({ title: seed.name, seed: true, travel: 'walk', validation: 'geo', authorNickname: 'SecretTracks', minAge: 6 });
    expect(entry.practical).toEqual(['stroller', 'cafe']);
    const others = (await client(ctx.app).get('/api/catalog')).body as { id: number; seed: boolean }[];
    expect(others.filter((e) => e.id !== first.catalogId).every((e) => !e.seed)).toBe(true);

    expect(await ctx.app.service.importSeed(seed)).toMatchObject({ status: 'skipped', catalogId: first.catalogId });

    // Jouable en autonomie, du départ au trésor.
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const hunt = (await zoe.post(`/api/catalog/${first.catalogId}/play`)).body;
    expect((await zoe.post(`/api/hunts/${hunt.id}/self-start`)).body.clue).toMatchObject({ instructions: seed.steps[0]!.riddle, hintsTotal: 3 });
    let last;
    for (const s of seed.steps.slice(1)) last = (await zoe.post(`/api/hunts/${hunt.id}/checkin`, { lat: s.lat, lng: s.lng, accuracy: 5 })).body;
    expect(last.step.isFinal).toBe(true);
  });

  it('remplace une version importée en retirant l’ancienne', async () => {
    const seed = { ...checkSeed(example()).seed!, summary: 'Nouvelle présentation.' };
    const before = (await ctx.pool.query('SELECT cat_id FROM th_catalog WHERE cat_seed = $1', [seed.key])).rows[0].cat_id;
    const r = await ctx.app.service.importSeed(seed, { replace: true });
    expect(r.status).toBe('replaced');
    expect(r.catalogId).not.toBe(before);
    const old = (await ctx.pool.query('SELECT cat_withdrawn, cat_seed FROM th_catalog WHERE cat_id = $1', [before])).rows[0];
    expect(old.cat_withdrawn).not.toBeNull();
    expect(old.cat_seed).toBeNull();
    expect((await client(ctx.app).get(`/api/catalog/${r.catalogId}`)).body).toMatchObject({ summary: 'Nouvelle présentation.', seed: true });
  });

  it('offre ses épreuves aux joueurs, mais ne les recopie qu’avec le pack', async () => {
    // Ailleurs que l'exemple déjà au catalogue, pour ne pas le copier (§ 48).
    const base = checkSeed(example()).seed!;
    const seed = { ...base, key: 'test-epreuves', steps: base.steps.map((s) => ({ ...s, lng: s.lng + 0.05 })) };
    seed.steps[2]!.puzzle = { type: 'cipher', prompt: 'Déchiffrez le message du roi.', answer: 'soleil', shift: 3 };
    const { catalogId } = await ctx.app.service.importSeed(seed);

    // Les joueurs ont l'épreuve sans rien posséder.
    const zoe = await loginAs(ctx.app, 'zoe@example.com');
    const hunt = (await zoe.post(`/api/catalog/${catalogId}/play`)).body;
    await zoe.post(`/api/hunts/${hunt.id}/self-start`);
    await zoe.post(`/api/hunts/${hunt.id}/checkin`, { lat: seed.steps[1]!.lat, lng: seed.steps[1]!.lng, accuracy: 5 });
    expect((await zoe.post(`/api/hunts/${hunt.id}/checkin`, { lat: seed.steps[2]!.lat, lng: seed.steps[2]!.lng, accuracy: 5 })).body.outcome).toBe('puzzle');
    expect((await zoe.post(`/api/hunts/${hunt.id}/puzzle`, { answer: 'Soleil' })).status).toBe(200);

    // Copié sans le pack : averti, puis sans l'épreuve.
    const tom = await loginAs(ctx.app, 'tom@example.com');
    expect((await tom.get(`/api/catalog/${catalogId}`)).body.copyWithout).toEqual(['Codes secrets']);
    const puzzles = async (huntId: number) => ((await tom.get(`/api/hunts/${huntId}/steps`)).body as { puzzle: unknown }[]).map((s) => s.puzzle);
    const bare = (await tom.post(`/api/catalog/${catalogId}/copy`)).body;
    expect((await puzzles(bare.id)).every((p) => p === null)).toBe(true);

    // Avec le pack, la copie la garde.
    await tom.post('/api/store/pack:codes/acquire');
    expect((await tom.get(`/api/catalog/${catalogId}`)).body.copyWithout).toEqual([]);
    const full = (await tom.post(`/api/catalog/${catalogId}/copy`)).body;
    expect((await puzzles(full.id))[2]).toMatchObject({ type: 'cipher', answer: 'soleil' });
  });

  it('ne laisse rien derrière un import qui échoue', async () => {
    const seed = { ...checkSeed(example()).seed!, key: 'test-echec', sampleOrder: 9 };
    const hunts = async () => (await ctx.pool.query('SELECT count(*)::int AS n FROM th_hunts')).rows[0].n;
    const n = await hunts();
    await expect(ctx.app.service.importSeed(seed)).rejects.toThrow(/extrait/);
    expect(await hunts()).toBe(n);
    expect((await ctx.pool.query('SELECT 1 FROM th_catalog WHERE cat_seed = $1', [seed.key])).rowCount).toBe(0);
  });
});
