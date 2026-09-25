import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { placesAround } from '../src/generation/osm.js';

/** Faux Overpass : répond selon un scénario, dans l'ordre des requêtes. */
let server: Server;
let base = '';
let script: ((res: import('node:http').ServerResponse) => void)[] = [];
const hits: string[] = [];

const ok = (elements: unknown[]) => (res: import('node:http').ServerResponse) =>
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ elements }));
const tooMany = (res: import('node:http').ServerResponse) => res.writeHead(429, { 'retry-after': '1' }).end('rate limited');
const overloaded = (res: import('node:http').ServerResponse) =>
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' }));

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');
    (script.shift() ?? ok([]))(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const fountain = { type: 'node', id: 1, lat: 43.6, lon: 3.88, tags: { name: 'Fontaine', amenity: 'fountain' } };

describe('OpenStreetMap : reprises', () => {
  it('réessaie sur le miroir suivant après une limite de débit ou une surcharge', async () => {
    config.overpassUrls = [`${base}/principal`, `${base}/miroir`];
    hits.length = 0;
    script = [tooMany, ok([fountain])];
    expect((await placesAround({ lat: 43.6, lng: 3.88 }, 500)).map((p) => p.name)).toEqual(['Fontaine']);
    expect(hits).toEqual(['/principal', '/miroir']);

    hits.length = 0;
    script = [overloaded, ok([fountain])];
    expect(await placesAround({ lat: 43.6, lng: 3.88 }, 500)).toHaveLength(1);
    expect(hits).toHaveLength(2);
  });

  it('abandonne avec un message clair après trois échecs', async () => {
    config.overpassUrls = [`${base}/principal`];
    script = [tooMany, tooMany, tooMany];
    const err = await placesAround({ lat: 43.6, lng: 3.88 }, 500).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/OpenStreetMap/);
    expect(String(err.cause.message)).toMatch(/429.*\|.*429.*\|.*429/);
  }, 10_000);
});
