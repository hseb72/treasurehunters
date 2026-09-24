import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';
import { createPool, tx } from './db.js';

/** Identifiant arbitraire du verrou consultatif des migrations (« TH » en ASCII). */
const MIGRATION_LOCK = 0x5448;

/** Dossier db/migrations du dépôt, cherché en remontant depuis ce fichier (sources ou dist). */
function migrationsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'db', 'migrations');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Dossier db/migrations introuvable.');
}

/** Applique, dans l'ordre, les scripts de db/migrations pas encore passés. Renvoie leurs noms. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  // Plusieurs répliques de l'API démarrent en même temps : un verrou consultatif
  // garantit qu'une seule applique les migrations, les autres attendent puis constatent.
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await lock.query(`CREATE TABLE IF NOT EXISTS th_migrations (
      mig_name varchar(255) PRIMARY KEY,
      mig_creation timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await lock.query('SELECT mig_name FROM th_migrations')).rows.map((r) => r.mig_name));
    const dir = migrationsDir();
    const applied: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      await tx(pool, async (db) => {
        await db.query(sql);
        await db.query('INSERT INTO th_migrations (mig_name) VALUES ($1)', [file]);
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    lock.release();
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const pool = createPool(config.databaseUrl);
  migrate(pool)
    .then((applied) => console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base à jour.'))
    .finally(() => pool.end());
}
