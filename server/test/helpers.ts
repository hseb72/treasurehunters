import { FastifyInstance } from 'fastify';
import pg from 'pg';
import { DEMO_TOKENS } from '../../shared/fixtures.js';
import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seedDemo } from '../src/seed-demo.js';

export const TEST_DB = process.env['TEST_DATABASE_URL'] ?? 'postgres://th:th@localhost:5432/treasurehunters_test';
export { DEMO_TOKENS };

export interface Ctx {
  pool: pg.Pool;
  app: FastifyInstance;
}

/** Base de test neuve : schéma recréé, migrations, jeu de démonstration. */
export async function setup(): Promise<Ctx> {
  const pool = createPool(TEST_DB);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  await seedDemo(pool);
  return { pool, app: await buildApp(pool) };
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
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body?: unknown) => call('POST', url, body ?? {}),
    patch: (url: string, body: unknown) => call('PATCH', url, body),
    put: (url: string, body: unknown) => call('PUT', url, body),
    del: (url: string) => call('DELETE', url),
  };
}

export async function loginAs(app: FastifyInstance, email: string) {
  const res = await client(app).post('/api/auth/login', { email, password: 'demo' });
  if (res.status !== 200) throw new Error(`Connexion impossible : ${JSON.stringify(res.body)}`);
  return client(app, res.body.token);
}
