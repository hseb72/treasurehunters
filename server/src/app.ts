import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import pg from 'pg';
import { z, ZodError } from 'zod';
import { resolveSession } from './auth.js';
import { config } from './config.js';
import { describeError, HttpError } from './errors.js';
import { HuntGenerator, OsmClaudeGenerator } from './generation/generator.js';
import { ClaudePhotoJudge, PhotoJudge } from './photos/judge.js';
import { ClaudeRiddleWriter, RiddleWriter } from './assist/writer.js';
import { ClaudeTranslator, Translator } from './translate/translator.js';
import { PhotoStore, S3PhotoStore, StoredPhoto } from './photos/store.js';
import { Payments } from './payments/payments.js';
import { PaymentProvider, StripeProvider } from './payments/stripe.js';
import { skinIdShape } from '../../shared/skins.js';
import { PRODUCT_IDS, TOOL_IDS } from '../../shared/store.js';
import { PUZZLE_TYPE_IDS } from '../../shared/puzzles.js';
import { PRACTICAL_IDS } from '../../shared/practical.js';
import { Service, Viewer } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    viewer: Viewer;
    token: string | null;
  }
}

/* ---------------------------------------------------------------- Schémas d'entrée */

const id = z.coerce.number().int().positive();
const idParams = z.object({ id });
const minutes = z.number().int().min(0).max(600);
const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable().transform((v) => v || null);

const huntFields = {
  name: text(50).min(1),
  description: text(5000),
  location: text(255),
  begin: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  autoStart: z.boolean(),
  autoClose: z.boolean(),
  award: nullableText(2000),
  startText: nullableText(5000),
  startMode: z.enum(['mass', 'staggered']),
  interval: z.number().int().min(1).max(600).nullable(),
  hintPenalties: z.array(minutes).length(3),
  skipPenalty: minutes,
  teamGame: z.boolean(),
  teamMin: z.number().int().min(1).max(50),
  teamMax: z.number().int().min(1).max(50),
  isPublic: z.boolean(),
  contribution: z.number().min(0).max(100_000),
  validation: z.enum(['qr', 'geo']),
  geoRadius: z.number().int().min(10).max(500),
  travel: z.enum(['walk', 'active', 'motor']),
  skin: z.string().max(40).refine(skinIdShape, 'Skin inconnu.'),
  tools: z
    .array(z.enum(TOOL_IDS))
    .max(TOOL_IDS.length)
    .transform((t) => [...new Set(t)]),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable(),
  durationMinutes: z.number().int().min(10).max(1440).nullable(),
};
const huntCreate = z.object(huntFields).partial().required({ name: true, begin: true, end: true });
const huntUpdate = z.object(huntFields).partial();

const stepFields = z
  .object({
    title: text(255).min(1),
    arrival: nullableText(5000),
    instructions: nullableText(5000),
    hints: z.array(text(2000)).max(3),
    address: nullableText(255),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    puzzle: z
      .object({
        type: z.enum(PUZZLE_TYPE_IDS),
        prompt: text(1000),
        answer: text(200),
        hint: nullableText(500).optional(),
        shift: z.number().int().min(1).max(25).optional(),
      })
      .nullable(),
    photoShow: z.enum(['arrival', 'clue']).nullable(),
  })
  .partial();

const generationRequest = z.object({
  location: z
    .object({
      query: text(200).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    })
    .refine((l) => !!l.query || (l.lat !== undefined && l.lng !== undefined), 'Indiquez un lieu.'),
  durationMinutes: z.number().int().min(20).max(360),
  // Absent des anciens clients : une balade à pied, sans thème.
  travel: z.enum(['walk', 'active', 'motor']).default('walk'),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  theme: text(120)
    .nullish()
    .transform((t) => t || null),
  steps: z.number().int().min(3).max(12).nullable(),
  mode: z.enum(['play', 'organize']),
  skin: z.string().max(40).refine(skinIdShape, 'Skin inconnu.').optional(),
  puzzles: z
    .array(z.enum(PUZZLE_TYPE_IDS))
    .max(PUZZLE_TYPE_IDS.length)
    .transform((t) => [...new Set(t)])
    .optional(),
});

const credentials = z.object({ email: z.email(), password: z.string().min(1).max(200) });
const registration = z.object({
  nickname: text(50).min(1),
  email: z.email(),
  password: z.string().min(8).max(200),
});

/* ---------------------------------------------------------------- Application */

export interface AppOptions {
  logger?: boolean;
  /** Générateur de chasses ; par défaut OpenStreetMap + Claude si ANTHROPIC_API_KEY est définie. */
  generator?: HuntGenerator | null;
  /** Stockage des photos (§ 12) ; par défaut le S3 de PHOTO_S3_*, sinon preuve par photo désactivée. */
  photoStore?: PhotoStore | null;
  /** Arbitre des photos ; par défaut Claude si ANTHROPIC_API_KEY est définie. */
  photoJudge?: PhotoJudge | null;
  /** Paiement (§ 20) ; par défaut Stripe si STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET sont définis. */
  payments?: PaymentProvider | null;
  /** Assistant de rédaction (§ 25) ; par défaut Claude si ANTHROPIC_API_KEY est définie. */
  writer?: RiddleWriter | null;
  /** Traduction des chasses (§ 33) ; par défaut Claude si ANTHROPIC_API_KEY est définie. */
  translator?: Translator | null;
}

export async function buildApp(pool: pg.Pool, opts: AppOptions = {}): Promise<FastifyInstance & { service: Service }> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  const key = config.anthropicApiKey;
  // Une clé qui n'est pas de l'ASCII imprimable (un modèle de commande copié tel quel : « sk-ant-… »)
  // ne peut pas partir dans un en-tête HTTP : chaque génération échouerait. On le dit une fois.
  const keyUsable = !!key && /^[\x21-\x7e]+$/.test(key);
  if (key && !keyUsable) app.log.error('ANTHROPIC_API_KEY invalide (caractères non ASCII ou espaces) : génération de Secret Tracks désactivée.');
  const generator = opts.generator !== undefined ? opts.generator : keyUsable ? new OsmClaudeGenerator(key!) : null;
  // Une clé refusée ou un modèle inconnu se voit dès le démarrage, pas à la première chasse.
  if (generator instanceof OsmClaudeGenerator) {
    generator.check().then(
      () => app.log.info(`Générateur de Secret Tracks prêt (modèle ${config.generatorModel}).`),
      (e) => app.log.error(e, `Générateur de Secret Tracks : ${e instanceof HttpError ? e.message : 'vérification impossible'} — ${describeError(e instanceof HttpError && e.cause ? e.cause : e)}`),
    );
  }
  const s3 = config.photoStore;
  const photoStore =
    opts.photoStore !== undefined
      ? opts.photoStore
      : s3.endpoint && s3.bucket && s3.accessKey && s3.secretKey
        ? new S3PhotoStore({ endpoint: s3.endpoint, bucket: s3.bucket, accessKey: s3.accessKey, secretKey: s3.secretKey, region: s3.region })
        : null;
  const photoJudge = opts.photoJudge !== undefined ? opts.photoJudge : keyUsable ? new ClaudePhotoJudge(key!) : null;
  const service = new Service(
    pool,
    generator,
    (err, msg) => app.log.error(err, msg),
    photoStore ? { store: photoStore, judge: photoJudge } : null,
  );

  const stripe = config.stripe;
  const provider = opts.payments !== undefined ? opts.payments : stripe.secretKey && stripe.webhookSecret ? new StripeProvider(stripe.secretKey, stripe.webhookSecret) : null;
  if (stripe.secretKey && !stripe.webhookSecret) app.log.error('STRIPE_WEBHOOK_SECRET manquant : paiement désactivé (les achats ne seraient jamais confirmés).');
  const payments = new Payments(pool, provider, (viewer) => service.store(viewer), (err, msg) => app.log.error(err, msg));
  service.payments = payments;
  service.writer = opts.writer !== undefined ? opts.writer : keyUsable ? new ClaudeRiddleWriter(key!) : null;
  service.translator = opts.translator !== undefined ? opts.translator : keyUsable ? new ClaudeTranslator(key!) : null;

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(rateLimit, { global: false });

  // Identification par « Authorization: Bearer <jeton> » ; un jeton invalide vaut « non connecté ».
  app.decorateRequest('viewer', null);
  app.decorateRequest('token', null);
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      req.token = header.slice(7);
      req.viewer = await resolveSession(pool, req.token);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ message: err.message });
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return reply.status(400).send({ message: `Donnée invalide : ${issue?.path.join('.') || 'requête'}.` });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ message: 'Trop de tentatives, réessayez dans un instant.' });
    if (status && status < 500) return reply.status(status).send({ message: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ message: 'Erreur interne du serveur.' });
  });

  const ua = (req: FastifyRequest) => req.headers['user-agent'];
  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/features', async () => service.features());

  /* ----- Boutique (§ 16) */
  app.get('/api/store', async (req) => service.store(req.viewer));
  app.post('/api/store/:product/acquire', async (req) => {
    const { product } = z.object({ product: z.union([z.enum(PRODUCT_IDS), z.string().regex(/^(skin|pack):u\d{1,9}$/)]) }).parse(req.params);
    return service.acquire(req.viewer, product);
  });
  /* ----- Paiement (§ 20) */
  const returnPath = z.object({ returnPath: z.string().max(300).regex(/^\/(?!\/)[^\s]*$/).default('/store') });
  app.post('/api/store/:product/checkout', async (req) => {
    const { product } = z.object({ product: z.string().regex(/^((skin|tool|pack|gen):[a-z0-9]{1,40}|hunt:c\d{1,9})$/) }).parse(req.params);
    return payments.checkout(req.viewer, product, returnPath.parse(req.body ?? {}).returnPath);
  });
  app.get('/api/generation/access', async (req) => service.generationAccess(req.viewer));
  app.get('/api/payments/account', async (req) => payments.account(req.viewer));
  app.post('/api/payments/account', async (req) => payments.onboard(req.viewer, returnPath.parse(req.body ?? {}).returnPath));
  // Webhook Stripe : la signature porte sur le corps brut, lu tel quel dans ce seul contexte.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.post('/api/payments/webhook', async (req) => payments.webhook(req.body as string, req.headers['stripe-signature'] as string | undefined));
  });

  /* ----- Créations de la communauté (§ 19) */
  const creationFields = {
    name: text(40).min(1),
    description: text(300),
    price: z.number().int().min(0).max(2000),
    content: z.unknown(),
  };
  const creations = service.creations;
  app.get('/api/creations/mine', async (req) => creations.mine(req.viewer));
  app.post('/api/creations', async (req, reply) =>
    reply.status(201).send(await creations.create(req.viewer, z.object({ kind: z.enum(['skin', 'pack']), ...creationFields }).parse(req.body))),
  );
  app.patch('/api/creations/:id', async (req) => creations.update(req.viewer, idParams.parse(req.params).id, z.object(creationFields).partial().parse(req.body)));
  app.delete('/api/creations/:id', async (req, reply) => {
    await creations.remove(req.viewer, idParams.parse(req.params).id);
    reply.status(204).send();
  });
  app.post('/api/creations/:id/submit', async (req) => creations.submit(req.viewer, idParams.parse(req.params).id));
  app.post('/api/creations/:id/withdraw', async (req) => creations.withdraw(req.viewer, idParams.parse(req.params).id));
  app.get('/api/creations/review', async (req) => creations.reviewQueue(req.viewer));
  app.post('/api/creations/:id/review', async (req) =>
    creations.review(req.viewer, idParams.parse(req.params).id, z.object({ approve: z.boolean(), note: nullableText(500).default(null) }).parse(req.body)),
  );
  app.get('/api/creations/:id/puzzles', async (req) => creations.packPuzzles(req.viewer, idParams.parse(req.params).id));
  app.get('/api/creators/:id', async (req) => creations.creator(idParams.parse(req.params).id));
  app.get('/api/skins/:id', async (req) => creations.skin(Number(z.object({ id: z.string().regex(/^u\d{1,9}$/) }).parse(req.params).id.slice(1))));

  app.post('/api/hunts/:id/puzzle', async (req) => {
    const { answer } = z.object({ answer: text(200) }).parse(req.body);
    return service.solvePuzzle(req.viewer, idParams.parse(req.params).id, answer);
  });
  app.post('/api/hunts/:id/puzzle/hint', async (req) => service.puzzleHint(req.viewer, idParams.parse(req.params).id));
  app.post('/api/hunts/:id/compass', async (req) => {
    const pos = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).parse(req.body);
    return service.compass(req.viewer, idParams.parse(req.params).id, pos);
  });

  /* ----- Comptes */
  app.post('/api/auth/register', strict, async (req) => {
    const b = registration.parse(req.body);
    return service.register(b.nickname, b.email, b.password, ua(req));
  });
  app.post('/api/auth/login', strict, async (req) => {
    const b = credentials.parse(req.body);
    return service.login(b.email, b.password, ua(req));
  });
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.token) await service.logout(req.token);
    return reply.status(204).send();
  });
  app.get('/api/me', async (req) => service.me(req.viewer));
  app.get('/api/me/journal', async (req) => service.journal(req.viewer));
  app.get('/api/me/in-progress', async (req) => service.inProgress(req.viewer));
  app.patch('/api/me', async (req) => {
    const b = z.object({ nickname: text(50).min(1), email: z.email(), rateable: z.boolean() }).partial().parse(req.body);
    return service.updateMe(req.viewer, b);
  });

  /* ----- Chasses */
  app.get('/api/hunts', async (req) => {
    const { scope } = z.object({ scope: z.enum(['public', 'playing', 'organized']).default('public') }).parse(req.query);
    return service.listHunts(req.viewer, scope);
  });
  app.get('/api/hunts/by-code/:code', async (req) => {
    const { code } = z.object({ code: text(20).min(1) }).parse(req.params);
    return service.findByCode(req.viewer, code);
  });
  app.get('/api/hunts/:id', async (req) => service.getHunt(req.viewer, idParams.parse(req.params).id));
  app.post('/api/hunts', async (req, reply) => reply.status(201).send(await service.createHunt(req.viewer, huntCreate.parse(req.body))));
  app.patch('/api/hunts/:id', async (req) => service.updateHunt(req.viewer, idParams.parse(req.params).id, huntUpdate.parse(req.body)));
  app.post('/api/hunts/:id/:action', async (req) => {
    const p = z.object({ id, action: z.enum(['publish', 'unpublish', 'start', 'close', 'cancel']) }).parse(req.params);
    return service.huntAction(req.viewer, p.id, p.action);
  });

  /* ----- Génération (§ 11) */
  // Compté par session (et non par adresse IP) : des joueurs derrière une même box ne se gênent pas.
  const perSession = { max: 5, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => req.headers.authorization ?? req.ip };
  app.post('/api/hunts/generate', { config: { rateLimit: perSession } }, async (req, reply) =>
    reply.status(202).send(await service.generate(req.viewer, generationRequest.parse(req.body))),
  );
  app.get('/api/generations/:id', async (req) => {
    const { id: genId } = z.object({ id: z.uuid() }).parse(req.params);
    return service.getGeneration(req.viewer, genId);
  });

  /* ----- Étapes */
  app.get('/api/hunts/:id/steps', async (req) => service.getSteps(req.viewer, idParams.parse(req.params).id));
  app.post('/api/hunts/:id/steps', async (req, reply) =>
    reply.status(201).send(await service.createStep(req.viewer, idParams.parse(req.params).id, stepFields.parse(req.body ?? {}))),
  );
  app.put('/api/hunts/:id/steps/order', async (req) => {
    const { stepIds } = z.object({ stepIds: z.array(id) }).parse(req.body);
    return service.reorderSteps(req.viewer, idParams.parse(req.params).id, stepIds);
  });
  app.patch('/api/steps/:id', async (req) => service.updateStep(req.viewer, idParams.parse(req.params).id, stepFields.parse(req.body)));
  app.delete('/api/steps/:id', async (req, reply) => {
    await service.deleteStep(req.viewer, idParams.parse(req.params).id);
    return reply.status(204).send();
  });
  app.post('/api/steps/:id/regenerate', async (req) => service.regenerateToken(req.viewer, idParams.parse(req.params).id));

  /* ----- Assistant de rédaction (§ 25) */
  app.get('/api/assist/usage', async (req) => service.assistUsage(req.viewer));
  app.post('/api/steps/:id/assist', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z
      .object({
        action: z.enum(['rephrase', 'easier', 'harder', 'hints', 'review']),
        instructions: z.string().max(5000),
        hints: z.array(z.string().max(1000)).max(3).default([]),
      })
      .parse(req.body);
    return service.assist(req.viewer, idParams.parse(req.params).id, body);
  });

  /* ----- Équipes */
  app.get('/api/hunts/:id/teams', async (req) => service.getTeams(req.viewer, idParams.parse(req.params).id));
  app.post('/api/hunts/:id/teams', async (req, reply) => {
    const { name } = z.object({ name: text(255).min(1) }).parse(req.body);
    return reply.status(201).send(await service.createTeam(req.viewer, idParams.parse(req.params).id, name));
  });
  app.put('/api/hunts/:id/teams/order', async (req) => {
    const { teamIds } = z.object({ teamIds: z.array(id) }).parse(req.body);
    return service.setStartOrder(req.viewer, idParams.parse(req.params).id, teamIds);
  });
  // Réponse vide (204) quand le joueur n'a pas d'équipe.
  app.get('/api/hunts/:id/my-team', async (req, reply) => {
    const team = await service.myTeam(req.viewer, idParams.parse(req.params).id);
    return team ?? reply.status(204).send();
  });
  app.delete('/api/hunts/:id/my-team', async (req, reply) => {
    await service.leaveHunt(req.viewer, idParams.parse(req.params).id);
    return reply.status(204).send();
  });
  app.post('/api/hunts/:id/solo', async (req, reply) => reply.status(201).send(await service.joinSolo(req.viewer, idParams.parse(req.params).id)));
  app.post('/api/teams/join', strict, async (req) => {
    const { code } = z.object({ code: text(20).min(1) }).parse(req.body);
    return service.joinTeam(req.viewer, code);
  });
  app.post('/api/teams/:id/delay', async (req) => {
    const { minutes: m } = z.object({ minutes: z.number().int().min(1).max(120) }).parse(req.body);
    return service.delayTeam(req.viewer, idParams.parse(req.params).id, m);
  });
  app.post('/api/teams/:id/validations', async (req) => {
    const { stepId } = z.object({ stepId: id }).parse(req.body);
    return service.validateManually(req.viewer, idParams.parse(req.params).id, stepId);
  });

  /* ----- Jeu */
  app.get('/api/hunts/:id/play', async (req) => service.getPlay(req.viewer, idParams.parse(req.params).id));
  app.post('/api/hunts/:id/hints', async (req) => service.revealHint(req.viewer, idParams.parse(req.params).id));
  app.post('/api/hunts/:id/skip', async (req) => service.skipStep(req.viewer, idParams.parse(req.params).id));
  app.post('/api/hunts/:id/self-start', async (req) => service.selfStart(req.viewer, idParams.parse(req.params).id));
  app.put('/api/hunts/:id/self-paced', async (req) => {
    const { selfPaced } = z.object({ selfPaced: z.boolean() }).parse(req.body);
    return service.setSelfPaced(req.viewer, idParams.parse(req.params).id, selfPaced);
  });
  app.post('/api/hunts/:id/checkin', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const pos = z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000) })
      .parse(req.body);
    return service.checkin(req.viewer, idParams.parse(req.params).id, pos, req.ip);
  });

  /* ----- Catalogue (§ 13) et notations (§ 14) */
  app.get('/api/catalog', async (req) => {
    // Listes à virgules : travel=walk,active.
    const list = <T extends string>(values: [T, ...T[]]) =>
      z
        .string()
        .max(40)
        .transform((s) => s.split(',').filter(Boolean))
        .pipe(z.array(z.enum(values)));
    const duration = z.coerce.number().int().min(0).max(1440);
    const q = z
      .object({
        q: text(100),
        sort: z.enum(['rating', 'recent', 'plays', 'distance']),
        mine: z.enum(['1', 'true']),
        hunt: id,
        travel: list(['walk', 'active', 'motor']),
        difficulty: list(['easy', 'medium', 'hard']),
        minDuration: duration,
        maxDuration: duration,
        autonomous: z.enum(['1', 'true']),
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        radius: z.coerce.number().positive().max(500),
        practical: list(PRACTICAL_IDS),
      })
      .partial()
      .parse(req.query);
    const { lat, lng, ...rest } = q;
    const near = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
    // mine / hunt : les publications du joueur (d'une de ses chasses), retirées comprises.
    return service.listCatalog(req.viewer, { ...rest, near, mine: !!q.mine, autonomous: !!q.autonomous });
  });
  app.get('/api/catalog/:id', async (req) => service.catalogEntry(req.viewer, idParams.parse(req.params).id));
  /* ----- Signalements et statistiques d'étape (§ 22) */
  app.post('/api/hunts/:id/reports', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const data = z
      .object({ stepOrder: z.number().int().min(1), category: z.enum(['closed', 'works', 'qr', 'riddle', 'danger', 'other']), message: nullableText(500).default(null) })
      .parse(req.body);
    return reply.status(201).send(await service.reportStep(req.viewer, idParams.parse(req.params).id, data));
  });
  app.get('/api/hunts/:id/reports', async (req) => service.huntReports(req.viewer, idParams.parse(req.params).id));
  /* ----- Version anglaise (§ 33) */
  app.post('/api/translate', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = z
      .object({ lang: z.literal('en'), hunt: id.optional(), catalog: z.array(id).max(30).optional(), info: z.array(id).max(30).optional() })
      .parse(req.body);
    return service.translate(req.viewer, body);
  });

  /* ----- Hors ligne (§ 32) */
  app.get('/api/hunts/:id/offline', async (req) => service.offlinePack(req.viewer, idParams.parse(req.params).id));
  app.post('/api/hunts/:id/offline/sync', async (req) => {
    const at = z.string().max(40);
    const base = { id: z.string().min(1).max(40), at };
    const events = z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ ...base, kind: z.literal('start') }),
          z.object({ ...base, kind: z.literal('arrive'), stepId: id, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(10_000) }),
          z.object({ ...base, kind: z.literal('scan'), stepId: id, token: z.string().min(1).max(64) }),
          z.object({ ...base, kind: z.literal('hint'), stepId: id }),
          z.object({ ...base, kind: z.literal('skip'), stepId: id }),
          z.object({ ...base, kind: z.literal('answer'), stepId: id, answer: z.string().max(200) }),
        ]),
      )
      .max(200)
      .parse((req.body as { events?: unknown } | null)?.events);
    return service.offlineSync(req.viewer, idParams.parse(req.params).id, events);
  });
  app.get('/api/hunts/:id/souvenir', async (req) => service.souvenir(req.viewer, idParams.parse(req.params).id));
  app.get('/api/hunts/:id/stats', async (req) => service.huntStats(req.viewer, idParams.parse(req.params).id));
  app.get('/api/catalog/:id/reports', async (req) => service.catalogReports(req.viewer, idParams.parse(req.params).id));
  app.get('/api/catalog/:id/stats', async (req) => service.catalogStats(req.viewer, idParams.parse(req.params).id));
  app.post('/api/reports/:id/resolve', async (req) =>
    service.resolveReport(req.viewer, idParams.parse(req.params).id, z.object({ resolved: z.boolean() }).parse(req.body).resolved),
  );
  app.post('/api/catalog/:id/play', async (req, reply) => reply.status(201).send(await service.playFromCatalog(req.viewer, idParams.parse(req.params).id)));
  app.get('/api/catalog/:id/challenge/:huntId', async (req) => {
    const p = z.object({ id, huntId: id }).parse(req.params);
    return service.challenge(req.viewer, p.id, p.huntId);
  });
  app.get('/api/catalog/:id/leaderboard', async (req) => service.autonomyLeaderboard(req.viewer, idParams.parse(req.params).id));
  app.post('/api/catalog/:id/copy', async (req, reply) => reply.status(201).send(await service.copyFromCatalog(req.viewer, idParams.parse(req.params).id)));
  app.delete('/api/catalog/:id', async (req) => service.withdrawFromCatalog(req.viewer, idParams.parse(req.params).id));
  app.post('/api/hunts/:id/catalog', async (req, reply) => {
    const pub = z
      .object({
        summary: text(5000),
        travel: z.enum(['walk', 'active', 'motor']),
        difficulty: z.enum(['easy', 'medium', 'hard']),
        durationMinutes: z.number().int().min(10).max(1440),
        sampleOrder: z.number().int().min(0),
        changes: text(2000).nullable(),
        price: z.number().int().min(0).max(5000).optional(),
        practical: z
          .array(z.enum(PRACTICAL_IDS))
          .max(PRACTICAL_IDS.length)
          .transform((t) => [...new Set(t)])
          .optional(),
        minAge: z.number().int().min(2).max(18).nullable().optional(),
      })
      .parse(req.body);
    return reply.status(201).send(await service.publishToCatalog(req.viewer, idParams.parse(req.params).id, pub));
  });
  const star = z.number().int().min(1).max(5);
  app.get('/api/hunts/:id/rating', async (req) => service.ratingState(req.viewer, idParams.parse(req.params).id));
  app.put('/api/hunts/:id/rating', async (req) => {
    const rating = z
      .object({ stars: star, riddles: star, route: star, mood: star, comment: text(2000).nullable(), organizer: star.nullable() })
      .parse(req.body);
    return service.rateHunt(req.viewer, idParams.parse(req.params).id, rating);
  });
  app.get('/api/organizers/:id', async (req) => service.organizerProfile(req.viewer, idParams.parse(req.params).id));

  /* ----- Preuve par photo (§ 12) : images en « data URL », 6 Mo au plus une fois décodées */
  const photoBody = z.object({ image: z.string().min(16).max(9_000_000) });
  const photoRoute = { bodyLimit: 9 * 1024 * 1024 };
  const sendImage = (reply: FastifyReply, image: StoredPhoto) =>
    reply.type(image.contentType).header('Cache-Control', 'private, max-age=3600').send(image.bytes);
  app.post('/api/hunts/:id/photos', { ...photoRoute, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) =>
    reply.status(201).send(await service.submitPhoto(req.viewer, idParams.parse(req.params).id, photoBody.parse(req.body).image)),
  );
  app.post('/api/photos/:id/insist', async (req) => service.insistPhoto(req.viewer, idParams.parse(req.params).id));
  app.get('/api/hunts/:id/photos', async (req) => service.huntPhotos(req.viewer, idParams.parse(req.params).id));
  app.post('/api/photos/:id/review', async (req) => {
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    return service.reviewPhoto(req.viewer, idParams.parse(req.params).id, approve);
  });
  app.get('/api/steps/:id/illustration', async (req, reply) => sendImage(reply, await service.illustrationImage(req.viewer, idParams.parse(req.params).id)));
  app.get('/api/photos/:id/image', async (req, reply) => sendImage(reply, await service.photoImage(req.viewer, idParams.parse(req.params).id)));
  app.get('/api/steps/:id/reference-photo', async (req, reply) =>
    sendImage(reply, await service.referenceImage(req.viewer, idParams.parse(req.params).id)),
  );
  app.put('/api/steps/:id/reference-photo', photoRoute, async (req) =>
    service.setReferencePhoto(req.viewer, idParams.parse(req.params).id, photoBody.parse(req.body).image),
  );
  app.delete('/api/steps/:id/reference-photo', async (req) => service.setReferencePhoto(req.viewer, idParams.parse(req.params).id, null));

  // POST : un scan peut valider une étape, il ne doit jamais être déclenché par un simple préchargement.
  app.post('/api/scan/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = z.object({ token: text(64).min(1) }).parse(req.params);
    return service.scan(req.viewer, token, req.ip);
  });

  /* ----- Résultats et pilotage */
  app.get('/api/hunts/:id/results', async (req) => service.getResults(req.viewer, idParams.parse(req.params).id));
  app.get('/api/hunts/:id/live', async (req) => service.getLive(req.viewer, idParams.parse(req.params).id));

  app.addHook('onClose', () => service.settle());
  return Object.assign(app as FastifyInstance, { service });
}
