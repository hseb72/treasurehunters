import { FastifyInstance } from 'fastify';
import pg from 'pg';
import { DEMO_TOKENS } from '../../shared/fixtures.js';
import { buildApp } from '../src/app.js';
import { DemoGenerator } from '../src/generation/generator.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seedDemo } from '../src/seed-demo.js';

export const TEST_DB = process.env['TEST_DATABASE_URL'] ?? 'postgres://th:th@localhost:5432/treasurehunters_test';
export { DEMO_TOKENS };

export interface Ctx {
  pool: pg.Pool;
  app: Awaited<ReturnType<typeof buildApp>>;
}

/** Base de test neuve : schéma recréé, migrations, jeu de démonstration. */
export async function setup(): Promise<Ctx> {
  const pool = createPool(TEST_DB);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  await seedDemo(pool);
  return { pool, app: await buildApp(pool, { generator: new DemoGenerator() }) };
}

export async function teardown(ctx: Ctx): Promise<void> {
  await ctx.app.close();
  await ctx.pool.end();
}

/** Client minimal : renvoie { status, body } et garde le jeton de session. */
export function client(app: FastifyInstance, token?: string) {
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const res = await app.inject({
      method,
      url,
      payload: payload as never,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    // Une image (photo servie par l'API) se lit en octets.
    const json = String(res.headers['content-type'] ?? '').includes('json');
    return { status: res.statusCode, body: res.body ? (json ? res.json() : res.rawPayload) : null };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body?: unknown) => call('POST', url, body ?? {}),
    patch: (url: string, body: unknown) => call('PATCH', url, body),
    put: (url: string, body: unknown) => call('PUT', url, body),
    del: (url: string) => call('DELETE', url),
  };
}

/** Une connexion par joueur et par application : la connexion est limitée à 20 par minute. */
const sessions = new WeakMap<FastifyInstance, Map<string, string>>();

export async function loginAs(app: FastifyInstance, email: string) {
  const known = sessions.get(app) ?? new Map<string, string>();
  sessions.set(app, known);
  if (!known.has(email)) {
    const res = await client(app).post('/api/auth/login', { email, password: 'demo' });
    if (res.status !== 200) throw new Error(`Connexion impossible : ${JSON.stringify(res.body)}`);
    known.set(email, res.body.token);
  }
  return client(app, known.get(email));
}

/** Une Secret Track générée à Montpellier (3 étapes, validation par géolocalisation), publiée au catalogue. */
export async function publishedEntry(ctx: Ctx, email: string, pub: Record<string, unknown> = {}) {
  const author = await loginAs(ctx.app, email);
  const job = await author.post('/api/hunts/generate', {
    location: { query: 'Montpellier', lat: 43.6085, lng: 3.8795 },
    durationMinutes: 45,
    travel: 'walk',
    difficulty: 'easy',
    theme: null,
    steps: 3,
    mode: 'organize',
  });
  await ctx.app.service.settle();
  const huntId: number = (await author.get(`/api/generations/${job.body.id}`)).body.huntId;
  const res = await author.post(`/api/hunts/${huntId}/catalog`, { summary: 'Balade.', travel: 'walk', difficulty: 'easy', durationMinutes: 45, sampleOrder: 0, changes: null, ...pub });
  if (res.status !== 201) throw new Error(`publication refusée : ${JSON.stringify(res.body)}`);
  return { entry: res.body, huntId, author };
}
