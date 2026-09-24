import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { Service } from './service.js';

const pool = createPool(config.databaseUrl);
await migrate(pool);

const app = await buildApp(pool, { logger: true });
await app.listen({ port: config.port, host: config.host });

// Départs et clôtures automatiques.
const service = new Service(pool);
const timer = setInterval(() => {
  service.runSchedule().catch((e) => app.log.error(e, 'Échec du planificateur'));
}, config.schedulerMs);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
