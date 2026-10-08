import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sharedStepRatio } from '../../shared/similarity.js';
import { Ctx, loginAs, setup, teardown } from './helpers.js';

const step = (order: number, lat: number | null, lng: number | null, title = `Étape ${order}`) => ({ order, title, latitude: lat, longitude: lng });

describe('similitude de deux parcours (§ 48)', () => {
  it('compte les lieux à moins de 40 m, départ exclu, chaque étape une seule fois', () => {
    const existing = [step(0, 43.6, 3.88), step(1, 43.601, 3.88), step(2, 43.602, 3.88), step(3, 43.603, 3.88)];
    // Mêmes lieux, à 10 m près, et un départ ailleurs : 100 %.
    expect(sharedStepRatio([step(0, 44, 4), step(1, 43.60109, 3.88), step(2, 43.6021, 3.88), step(3, 43.603, 3.8801)], existing)).toBe(1);
    // Deux lieux sur trois en commun.
    expect(sharedStepRatio([step(0, 43.6, 3.88), step(1, 43.601, 3.88), step(2, 43.602, 3.88), step(3, 43.7, 3.9)], existing)).toBeCloseTo(2 / 3);
    // Deux étapes au même endroit ne comptent qu'une fois.
    expect(sharedStepRatio([step(0, 0, 0), step(1, 43.601, 3.88), step(2, 43.601, 3.88)], [step(0, 0, 0), step(1, 43.601, 3.88)])).toBe(0.5);
    // Sans coordonnées : même titre, accents et casse ignorés.
    expect(sharedStepRatio([step(0, null, null), step(1, null, null, 'La Fontaine'), step(2, null, null, 'Le kiosque')], [step(1, null, null, 'la fontaine !')])).toBe(0.5);
    expect(sharedStepRatio([step(0, 0, 0)], existing)).toBe(0);
  });
});

describe('publication au catalogue : contrôle de similitude', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));

  /** Le même parcours de démonstration, généré au même endroit. */
  async function generate(email: string, lng = 3.8795) {
    const author = await loginAs(ctx.app, email);
    const job = await author.post('/api/hunts/generate', {
      location: { query: 'Montpellier', lat: 43.6085, lng },
      durationMinutes: 45,
      travel: 'walk',
      difficulty: 'easy',
      theme: null,
      steps: 3,
      mode: 'organize',
    });
    await ctx.app.service.settle();
    return { author, huntId: (await author.get(`/api/generations/${job.body.id}`)).body.huntId as number };
  }
  const pub = { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null };

  it('refuse un parcours déjà au catalogue, mais pas une nouvelle version de la même lignée', async () => {
    const seb = await generate('seb@example.com');
    const original = await seb.author.post(`/api/hunts/${seb.huntId}/catalog`, pub);
    expect(original.status).toBe(201);

    // Camille propose les mêmes étapes, sous son nom : refusé, avec la Secret Track en cause.
    const camille = await generate('camille@example.com');
    const copy = await camille.author.post(`/api/hunts/${camille.huntId}/catalog`, pub);
    expect(copy.status).toBe(409);
    expect(copy.body.message).toContain('« Les secrets de Montpellier » de seb (100 % d’étapes en commun)');

    // Un parcours ailleurs passe.
    const elsewhere = await generate('camille@example.com', 3.9);
    expect((await elsewhere.author.post(`/api/hunts/${elsewhere.huntId}/catalog`, pub)).status).toBe(201);

    // Copiée depuis le catalogue puis améliorée, c'est une nouvelle version : acceptée.
    const draft = await camille.author.post(`/api/catalog/${original.body.id}/copy`, {});
    expect(draft.status).toBe(201);
    const steps = (await camille.author.get(`/api/hunts/${draft.body.id}/steps`)).body as { id: number; order: number }[];
    await camille.author.patch(`/api/steps/${steps.find((s) => s.order === 1)!.id}`, { instructions: 'Une énigme réécrite, plus claire.' });
    const version = await camille.author.post(`/api/hunts/${draft.body.id}/catalog`, { ...pub, changes: 'Énigme 1 clarifiée.' });
    expect(version.status).toBe(201);
    expect(version.body.parent).toMatchObject({ id: original.body.id });

    // L'auteur d'origine peut aussi publier une nouvelle version de la sienne.
    const own = (await seb.author.get(`/api/hunts/${seb.huntId}/steps`)).body as { id: number; order: number }[];
    await seb.author.patch(`/api/steps/${own.find((s) => s.order === 2)!.id}`, { instructions: 'Une énigme améliorée.' });
    expect((await seb.author.post(`/api/hunts/${seb.huntId}/catalog`, { ...pub, changes: 'Énigme 2 améliorée.' })).status).toBe(201);

    // Une Secret Track retirée du catalogue ne bloque plus personne.
    await ctx.pool.query('UPDATE th_catalog SET cat_withdrawn = now()');
    expect((await camille.author.post(`/api/hunts/${camille.huntId}/catalog`, pub)).status).toBe(201);
  });
});
