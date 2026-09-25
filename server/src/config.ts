/** Configuration lue dans l'environnement (voir .env.example). */
export const config = {
  port: Number(process.env['PORT'] ?? 3000),
  host: process.env['HOST'] ?? '0.0.0.0',
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://th:th@localhost:5432/treasurehunters',
  corsOrigin: (process.env['CORS_ORIGIN'] ?? 'http://localhost:4200').split(',').map((s) => s.trim()),
  sessionDays: Number(process.env['SESSION_DAYS'] ?? 30),
  /** Fréquence de vérification des départs et clôtures automatiques. */
  schedulerMs: 30_000,
  /** Génération de chasses (§ 11) : désactivée sans clé d'API Anthropic. */
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] || null,
  generatorModel: process.env['GENERATOR_MODEL'] ?? 'claude-opus-5',
  generatorEffort: (process.env['GENERATOR_EFFORT'] ?? 'medium') as 'low' | 'medium' | 'high',
  /** Générations autorisées par joueur sur 24 heures glissantes. */
  generationDailyQuota: Number(process.env['GENERATION_DAILY_QUOTA'] ?? 5),
  /** Identification exigée par les services OpenStreetMap (Nominatim, Overpass). */
  osmUserAgent: process.env['OSM_USER_AGENT'] ?? 'TreasureHunters/1.0 (+https://treasurehunters.crealcs.com)',
  nominatimUrl: process.env['NOMINATIM_URL'] ?? 'https://nominatim.openstreetmap.org',
  overpassUrl: process.env['OVERPASS_URL'] ?? 'https://overpass-api.de/api/interpreter',
};
