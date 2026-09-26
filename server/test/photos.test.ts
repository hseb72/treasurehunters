import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { PhotoCase, PhotoJudge, PhotoVerdict } from '../src/photos/judge.js';
import { MemoryPhotoStore, signS3 } from '../src/photos/store.js';
import { Ctx, loginAs, setup, teardown } from './helpers.js';

/** Arbitre scripté : rend les avis dans l'ordre et garde les cas reçus. */
class ScriptedJudge implements PhotoJudge {
  verdicts: PhotoVerdict[] = [];
  cases: PhotoCase[] = [];
  async judge(c: PhotoCase): Promise<PhotoVerdict> {
    this.cases.push(c);
    return this.verdicts.shift() ?? { match: false, reason: 'Pas reconnu.' };
  }
}

/** Assez d'octets pour être reconnus comme un JPEG. */
const jpeg = (tag: string) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]).toString('base64')}`;

let ctx: Ctx;
let app: Awaited<ReturnType<typeof buildApp>>;
const store = new MemoryPhotoStore();
const judge = new ScriptedJudge();

beforeAll(async () => {
  ctx = await setup();
  app = await buildApp(ctx.pool, { photoStore: store, photoJudge: judge });
});
afterAll(async () => {
  await app.close();
  await teardown(ctx);
});

/** Un joueur d'une équipe encore en course sur la chasse 1 (à QR codes, organisée par Camille). */
async function runner() {
  const r = await ctx.pool.query(
    `SELECT u.htr_email FROM th_teamhunters m JOIN th_teams t ON t.tea_id = m.thr_team_tea JOIN th_hunters u ON u.htr_id = m.thr_hunter_htr
     WHERE t.tea_hunt_hun = 1 AND t.tea_finished IS NULL AND t.tea_started IS NOT NULL ORDER BY t.tea_id LIMIT 1`,
  );
  return loginAs(app, r.rows[0].htr_email);
}

describe('preuve par photo', () => {
  it('annonce la fonction, et la refuse sans stockage', async () => {
    const player = await runner();
    expect((await player.get('/api/features')).body).toEqual({ photos: true, generation: false });
    expect((await player.get('/api/hunts/1/play')).body.photoProof).toBe(true);
    const bare = await buildApp(ctx.pool, { photoStore: null });
    const res = await (await loginAs(bare, 'seb@example.com')).post('/api/hunts/1/photos', { image: jpeg('x') });
    expect(res.status).toBe(503);
    await bare.close();
  });

  it('refuse ce qui n’est pas une image', async () => {
    const player = await runner();
    const res = await player.post('/api/hunts/1/photos', { image: Buffer.from('pas une image du tout').toString('base64') });
    expect(res.status).toBe(400);
  });

  it('laisse réessayer ou insister quand l’IA ne reconnaît pas le lieu, puis l’organisateur tranche', async () => {
    const player = await runner();
    const camille = await loginAs(app, 'camille@example.com');
    const before = (await player.get('/api/hunts/1/play')).body;
    const target = before.clue.targetOrder;

    // Photo de référence de l'organisateur : transmise à l'IA, jamais aux joueurs.
    const steps = (await camille.get('/api/hunts/1/steps')).body;
    const step = steps.find((s: { order: number }) => s.order === target);
    expect((await camille.put(`/api/steps/${step.id}/reference-photo`, { image: jpeg('ref') })).body.referencePhoto).toBe(true);
    expect((await player.get(`/api/steps/${step.id}/reference-photo`)).status).toBe(403);

    judge.verdicts = [{ match: false, reason: 'La photo ne semble pas montrer le lieu.' }];
    const miss = await player.post('/api/hunts/1/photos', { image: jpeg('essai 1') });
    expect(miss.status).toBe(201);
    expect(miss.body.photo).toMatchObject({ verdict: 'nomatch', insisted: false, review: null, stepOrder: target });
    expect(miss.body.state.clue.targetOrder).toBe(target); // pas validée
    expect(judge.cases.at(-1)!.reference!.bytes.toString()).toContain('ref');

    // L'image reste visible de l'équipe et de l'organisateur seulement.
    expect((await app.inject({ url: `/api/photos/${miss.body.photo.id}/image`, headers: { authorization: '' } })).statusCode).toBe(401);
    const outsider = await loginAs(app, 'emma@example.com');
    expect((await outsider.get(`/api/photos/${miss.body.photo.id}/image`)).status).toBe(404);

    // L'équipe insiste : étape validée tout de suite, à contrôler.
    const insisted = await player.post(`/api/photos/${miss.body.photo.id}/insist`);
    expect(insisted.body.photo).toMatchObject({ insisted: true, review: 'pending' });
    expect(insisted.body.state.clue.targetOrder).toBe(target + 1);
    expect(insisted.body.state.validated.at(-1)).toMatchObject({ order: target, photo: 'pending', skipped: false });
    expect((await player.post(`/api/photos/${miss.body.photo.id}/insist`)).status).toBe(409);

    // Étape suivante : l'IA reconnaît le lieu, validation immédiate.
    judge.verdicts = [{ match: true, reason: 'Le lieu est bien reconnu.' }];
    const hit = await player.post('/api/hunts/1/photos', { image: jpeg('essai 2') });
    expect(hit.body.photo).toMatchObject({ verdict: 'match', review: 'pending' });
    expect(hit.body.state.clue.targetOrder).toBe(target + 2);

    const live = (await camille.get('/api/hunts/1/live')).body;
    expect(live.find((r: { team: { id: number } }) => r.team.id === before.team.id).photosToReview).toBe(2);
    expect((await player.get('/api/hunts/1/photos')).status).toBe(403);

    // Contrôle : la photo insistée est refusée (abandon de l'épreuve), l'autre tamponnée.
    await camille.post(`/api/photos/${miss.body.photo.id}/review`, { approve: false });
    const reviewed = (await camille.post(`/api/photos/${hit.body.photo.id}/review`, { approve: true })).body;
    expect(reviewed.map((p: { id: number; review: string }) => [p.id, p.review])).toEqual([
      [miss.body.photo.id, 'rejected'],
      [hit.body.photo.id, 'approved'],
    ]);
    expect((await camille.post(`/api/photos/${hit.body.photo.id}/review`, { approve: false })).status).toBe(409);
    const after = (await player.get('/api/hunts/1/play')).body;
    expect(after.skipsUsed).toBe(before.skipsUsed + 1);
    expect(after.validated.find((v: { order: number }) => v.order === target)).toMatchObject({ skipped: true, photo: 'rejected' });
  });

  it('efface les photos des équipes 30 jours après la clôture', async () => {
    expect(store.objects.size).toBeGreaterThan(0);
    await ctx.pool.query(`UPDATE th_hunts SET hun_status_hst = 4, hun_closed = now() - interval '31 days' WHERE hun_id = 1`);
    await app.service.runSchedule();
    expect([...store.objects.keys()].every((k) => k.startsWith('refs/'))).toBe(true); // la référence reste
    const photos = (await (await loginAs(app, 'camille@example.com')).get('/api/hunts/1/photos')).body;
    expect(photos.every((p: { purged: boolean }) => p.purged)).toBe(true);
  });
});

describe('signature S3', () => {
  it('reproduit l’exemple de la documentation AWS (GET avec Range)', () => {
    const headers = signS3(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        headers: { Range: 'bytes=0-9' },
      },
      { accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' },
      new Date('2013-05-24T00:00:00Z'),
    );
    expect(headers['authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});
