/** Configuration lue dans l'environnement (voir .env.example). */
export const config = {
  port: Number(process.env['PORT'] ?? 3000),
  host: process.env['HOST'] ?? '0.0.0.0',
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://th:th@localhost:5432/treasurehunters',
  corsOrigin: (process.env['CORS_ORIGIN'] ?? 'http://localhost:4200').split(',').map((s) => s.trim()),
  sessionDays: Number(process.env['SESSION_DAYS'] ?? 30),
  /** Fréquence de vérification des départs et clôtures automatiques. */
  schedulerMs: 30_000,
};
