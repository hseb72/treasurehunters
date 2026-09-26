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
  /** Workspace à utiliser, exigé par l'API quand la clé n'est rattachée à aucun workspace. */
  anthropicWorkspaceId: process.env['ANTHROPIC_WORKSPACE_ID']?.trim() || null,
  generatorModel: process.env['GENERATOR_MODEL'] ?? 'claude-opus-5',
  generatorEffort: (process.env['GENERATOR_EFFORT'] ?? 'medium') as 'low' | 'medium' | 'high',
  /** Générations autorisées par joueur sur 24 heures glissantes. */
  generationDailyQuota: Number(process.env['GENERATION_DAILY_QUOTA'] ?? 5),
  /**
   * Preuve par photo (§ 12) : stockage S3 (MinIO mutualisé). Désactivée si l'un manque.
   * La région n'importe pas à MinIO mais entre dans la signature.
   */
  photoStore: {
    endpoint: process.env['PHOTO_S3_ENDPOINT'] || null,
    bucket: process.env['PHOTO_S3_BUCKET'] || null,
    accessKey: process.env['PHOTO_S3_ACCESS_KEY'] || null,
    secretKey: process.env['PHOTO_S3_SECRET_KEY'] || null,
    region: process.env['PHOTO_S3_REGION'] ?? 'us-east-1',
  },
  /** Les photos des équipes sont effacées ce nombre de jours après la clôture de la chasse. */
  photoRetentionDays: Number(process.env['PHOTO_RETENTION_DAYS'] ?? 30),
  /** Identification exigée par les services OpenStreetMap (Nominatim, Overpass). */
  osmUserAgent: process.env['OSM_USER_AGENT'] ?? 'TreasureHunters/1.0 (+https://treasurehunters.crealcs.com)',
  nominatimUrl: process.env['NOMINATIM_URL'] ?? 'https://nominatim.openstreetmap.org',
  /** Instances Overpass publiques, essayées tour à tour (séparées par des virgules). */
  overpassUrls: (
    process.env['OVERPASS_URLS'] ??
    [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ].join(',')
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
