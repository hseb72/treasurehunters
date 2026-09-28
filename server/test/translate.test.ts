import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Translator } from '../src/translate/translator.js';
import { client, Ctx, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

class FakeTranslator implements Translator {
  calls = 0;
  fail = false;
  async translate(texts: string[]) {
    this.calls++;
    if (this.fail) throw new Error('panne');
    return texts.map((t) => `EN: ${t}`);
  }
}

describe('version anglaise (§ 33)', () => {
  it('traduit ce que le joueur voit, une seule fois, sans rien dévoiler du parcours', async () => {
    const tr = new FakeTranslator();
    ctx.app.service.translator = tr;
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const play = (await seb.get('/api/hunts/1/play')).body;
    const map = (await seb.post('/api/translate', { lang: 'en', hunt: 1 })).body as Record<string, string>;
    expect(map[play.clue.instructions]).toBe(`EN: ${play.clue.instructions}`);
    expect(map[play.hunt.name]).toBe(`EN: ${play.hunt.name}`);
    for (const v of play.validated) expect(map[v.title]).toBe(`EN: ${v.title}`);

    // Les énigmes et lieux à venir ne partent jamais, ni à l'IA ni au joueur.
    const future = (await ctx.pool.query('SELECT cod_title, cod_instructions FROM th_codes WHERE cod_hunt_hun = 1 AND cod_order > $1', [play.clue.targetOrder])).rows;
    for (const f of future) {
      expect(map[f.cod_title]).toBeUndefined();
      if (f.cod_instructions) expect(map[f.cod_instructions]).toBeUndefined();
    }

    // Deuxième demande : tout vient du cache.
    tr.fail = true;
    const calls = tr.calls;
    expect((await seb.post('/api/translate', { lang: 'en', hunt: 1 })).body).toEqual(map);
    expect(tr.calls).toBe(calls);

    // Fiches du catalogue : ouvertes à tous.
    tr.fail = false;
    const entries = (await client(ctx.app).get('/api/catalog')).body as { id: number; title: string; summary: string }[];
    if (entries.length) {
      const cat = (await client(ctx.app).post('/api/translate', { lang: 'en', catalog: [entries[0]!.id] })).body;
      expect(cat[entries[0]!.title]).toBe(`EN: ${entries[0]!.title}`);
    }

    // Fiches publiques des expéditions (accueil, page d'une expédition).
    const info = (await client(ctx.app).post('/api/translate', { lang: 'en', info: [1] })).body;
    expect(info[play.hunt.name]).toBe(`EN: ${play.hunt.name}`);

    // Une partie dont on n'est pas.
    const louis = await loginAs(ctx.app, 'louis@example.com');
    expect([403, 404]).toContain((await louis.post('/api/translate', { lang: 'en', hunt: 1 })).status);
    expect((await seb.post('/api/translate', { lang: 'de', hunt: 1 })).status).toBe(400);
  });
});
