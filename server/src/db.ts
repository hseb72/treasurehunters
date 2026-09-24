import pg from 'pg';

// numeric (participation, coordonnées) → number ; bigint → number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number.parseFloat(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

export type Db = pg.Pool | pg.PoolClient;
export type Row = Record<string, any>;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

export async function rows(db: Db, sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query(sql, params)).rows;
}

export async function one(db: Db, sql: string, params: unknown[] = []): Promise<Row | undefined> {
  return (await db.query(sql, params)).rows[0];
}

/** Exécute fn dans une transaction ; annule tout en cas d'erreur. */
export async function tx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
