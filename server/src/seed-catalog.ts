/**
 * Import des parcours d'initialisation (docs/conception.md § 51).
 *
 *   node dist/server/src/seed-catalog.js [--dry-run] [--replace] <fichier.json | dossier>…
 *
 * Chaque fichier est contrôlé (checkSeed) puis importé sous le compte « SecretTracks » et partagé
 * au catalogue. Une clé déjà importée est sautée, sauf --replace. --dry-run ne fait que contrôler.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { checkSeed } from './seed/validate.js';

/** Les fichiers .json désignés, dossiers parcourus (sans récursion), dans l'ordre alphabétique. */
export function seedFiles(paths: string[]): string[] {
  return paths.flatMap((p) =>
    statSync(p).isDirectory()
      ? readdirSync(p)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => join(p, f))
      : [p],
  );
}

async function main(argv: string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const replace = argv.includes('--replace');
  const paths = argv.filter((a) => !a.startsWith('--'));
  if (!paths.length) {
    console.error('Usage : seed-catalog [--dry-run] [--replace] <fichier.json | dossier>…');
    return 2;
  }
  const files = seedFiles(paths);
  const checked = files.map((file) => {
    try {
      return { file, ...checkSeed(JSON.parse(readFileSync(file, 'utf8'))) };
    } catch (e) {
      return { file, seed: null, errors: [`lecture impossible : ${(e as Error).message}`] };
    }
  });
  let failed = 0;
  const keys = new Map<string, string>();
  for (const c of checked) {
    if (c.seed) {
      const other = keys.get(c.seed.key);
      if (other) c.errors.push(`clé « ${c.seed.key} » déjà utilisée par ${other}.`);
      keys.set(c.seed.key, c.file);
    }
    if (c.errors.length) {
      failed++;
      console.error(`✗ ${c.file}\n${c.errors.map((e) => `    ${e}`).join('\n')}`);
    }
  }
  if (dryRun) {
    console.log(`${checked.length - failed} parcours valides sur ${checked.length}.`);
    return failed ? 1 : 0;
  }
  const pool = createPool(config.databaseUrl);
  const app = await buildApp(pool);
  try {
    for (const c of checked) {
      if (c.errors.length || !c.seed) continue;
      try {
        const r = await app.service.importSeed(c.seed, { replace });
        const label = { imported: 'importé', replaced: 'remplacé', skipped: 'déjà présent' }[r.status];
        console.log(`✓ ${c.seed.key} : ${label} (catalogue n° ${r.catalogId})`);
        for (const w of r.warnings) console.log(`    ! ${w}`);
      } catch (e) {
        failed++;
        console.error(`✗ ${c.seed.key} : ${(e as Error).message}`);
      }
    }
  } finally {
    await app.close();
    await pool.end();
  }
  return failed ? 1 : 0;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
      console.error((e as Error).message);
      process.exitCode = 1;
    },
  );
}
