import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import pg from 'pg';
import { z, ZodError } from 'zod';
import { resolveSession } from './auth.js';
import { config } from './config.js';
import { HttpError } from './errors.js';
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
  teamGame: z.boolean(),
  teamMin: z.number().int().min(1).max(50),
  teamMax: z.number().int().min(1).max(50),
  isPublic: z.boolean(),
  contribution: z.number().min(0).max(100_000),
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
  })
  .partial();

const credentials = z.object({ email: z.email(), password: z.string().min(1).max(200) });
const registration = z.object({
  nickname: text(50).min(1),
  email: z.email(),
  password: z.string().min(8).max(200),
});

/* ---------------------------------------------------------------- Application */

export async function buildApp(pool: pg.Pool, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  const service = new Service(pool);

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
  app.patch('/api/me', async (req) => {
    const b = z.object({ nickname: text(50).min(1), email: z.email() }).partial().parse(req.body);
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
  // POST : un scan peut valider une étape, il ne doit jamais être déclenché par un simple préchargement.
  app.post('/api/scan/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = z.object({ token: text(64).min(1) }).parse(req.params);
    return service.scan(req.viewer, token, req.ip);
  });

  /* ----- Résultats et pilotage */
  app.get('/api/hunts/:id/results', async (req) => service.getResults(req.viewer, idParams.parse(req.params).id));
  app.get('/api/hunts/:id/live', async (req) => service.getLive(req.viewer, idParams.parse(req.params).id));

  return app;
}
