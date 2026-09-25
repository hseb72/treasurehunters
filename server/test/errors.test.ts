import Anthropic from '@anthropic-ai/sdk';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { describeError, HttpError } from '../src/errors.js';
import { apiFailure, ClaudePlanner } from '../src/generation/claude.js';
import { placesAround } from '../src/generation/osm.js';

const apiError = (status: number, type: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message: `détail ${type}` } }, undefined, new Headers({ 'request-id': 'req_42' }));

describe('Journaux : causes techniques', () => {
  it('déroule la chaîne des causes et les codes réseau', () => {
    const net = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' });
    const tls = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    expect(describeError(new TypeError('fetch failed', { cause: net }))).toBe('fetch failed ← connect ECONNREFUSED 10.0.0.1:443');
    expect(describeError(new TypeError('fetch failed', { cause: tls }))).toBe('fetch failed ← socket hang up [ECONNRESET]');
    expect(describeError(new AggregateError([net, tls], ''))).toMatch(/ECONNREFUSED.* \/ .*ECONNRESET/);
  });

  it('dit pourquoi OpenStreetMap est injoignable', async () => {
    // Port libéré juste avant : connexion refusée.
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((r) => probe.close(() => r()));
    config.overpassUrls = [`http://127.0.0.1:${port}/api/interpreter`];
    const err = await placesAround({ lat: 43.6, lng: 3.88 }, 500).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.cause.message).toMatch(/injoignable : fetch failed ← .*ECONNREFUSED/);
  }, 15_000);
});

describe('API Anthropic : erreurs', () => {
  it('distingue configuration, surcharge et coupure', () => {
    const msg = (e: unknown) => (apiFailure(e) as HttpError).message;
    expect(msg(apiError(401, 'authentication_error'))).toMatch(/clé d’API/);
    expect(msg(apiError(403, 'permission_error'))).toMatch(/clé d’API/);
    expect(msg(apiError(404, 'not_found_error'))).toMatch(/modèle/);
    expect(msg(apiError(400, 'invalid_request_error'))).toMatch(/crédit/);
    expect(msg(apiError(529, 'overloaded_error'))).toMatch(/surchargé/);
    expect(msg(apiError(429, 'rate_limit_error'))).toMatch(/sollicité/);
    expect(msg(new Anthropic.APIConnectionError({ cause: new Error('getaddrinfo ENOTFOUND api.anthropic.com') }))).toMatch(/ne répond pas/);
  });

  it('journalise le statut, le détail et l’identifiant de requête', () => {
    const err = apiFailure(apiError(400, 'invalid_request_error')) as HttpError;
    expect(describeError(err.cause)).toMatch(/400 .*détail invalid_request_error.*request_id req_42/);
    const other = new Error('autre');
    expect(apiFailure(other)).toBe(other);
  });
});

describe('API Anthropic : workspace', () => {
  it('envoie anthropic-workspace-id quand ANTHROPIC_WORKSPACE_ID est défini', async () => {
    const headers: (string | undefined)[] = [];
    const api = createServer((req, res) => {
      headers.push(req.headers['anthropic-workspace-id'] as string | undefined);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'model', id: config.generatorModel }));
    });
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
    const saved = [process.env['ANTHROPIC_BASE_URL'], config.anthropicWorkspaceId] as const;
    process.env['ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    try {
      config.anthropicWorkspaceId = 'wrkspc_test';
      await new ClaudePlanner('sk-ant-test').check();
      config.anthropicWorkspaceId = null;
      await new ClaudePlanner('sk-ant-test').check();
      expect(headers).toEqual(['wrkspc_test', undefined]);
    } finally {
      if (saved[0] === undefined) delete process.env['ANTHROPIC_BASE_URL'];
      else process.env['ANTHROPIC_BASE_URL'] = saved[0];
      config.anthropicWorkspaceId = saved[1];
      await new Promise<void>((r) => api.close(() => r()));
    }
  });
});
