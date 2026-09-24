import { client, Ctx, DEMO_TOKENS, loginAs, setup, teardown } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => teardown(ctx));

describe('comptes', () => {
  it('inscrit, connecte et déconnecte un joueur', async () => {
    const anon = client(ctx.app);
    const reg = await anon.post('/api/auth/register', { nickname: 'Indy', email: 'indy@example.com', password: 'fouet-et-chapeau' });
    expect(reg.status).toBe(200);
    expect(reg.body.user.nickname).toBe('Indy');

    const again = await anon.post('/api/auth/register', { nickname: 'Autre', email: 'INDY@example.com', password: 'fouet-et-chapeau' });
    expect(again.status).toBe(409);

    const bad = await anon.post('/api/auth/login', { email: 'indy@example.com', password: 'mauvais' });
    expect(bad.status).toBe(401);

    const me = client(ctx.app, reg.body.token);
    expect((await me.get('/api/me')).body.email).toBe('indy@example.com');
    expect((await me.post('/api/auth/logout')).status).toBe(204);
    expect((await me.get('/api/me')).status).toBe(401);
  });

  it('stocke les mots de passe hashés', async () => {
    const r = await ctx.pool.query(`SELECT sec_password FROM th_secrets LIMIT 1`);
    expect(r.rows[0].sec_password).toMatch(/^\$argon2id\$/);
  });
});

describe('scan de QR code (§ 4.2)', () => {
  it('guide un visiteur, refuse les raccourcis et valide l’étape suivante', async () => {
    const anon = client(ctx.app);
    expect((await anon.post(`/api/scan/${DEMO_TOKENS.nefles[3]}`)).body.outcome).toBe('login_required');
    expect((await anon.post('/api/scan/inconnu')).body.outcome).toBe('unknown');

    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.post(`/api/scan/${DEMO_TOKENS.nefles[5]}`)).body.outcome).toBe('skipped');
    expect((await seb.post(`/api/scan/${DEMO_TOKENS.nefles[2]}`)).body.outcome).toBe('already_validated');

    const ok = await seb.post(`/api/scan/${DEMO_TOKENS.nefles[3]}`);
    expect(ok.body.outcome).toBe('validated');
    expect(ok.body.step.title).toBe('Parc Méric — boulodrome');
    expect(ok.body.next.targetOrder).toBe(4);

    const play = await seb.get('/api/hunts/1/play');
    expect(play.body.validated).toHaveLength(3);
    expect(play.body.clue.targetOrder).toBe(4);
    expect(play.body.position.total).toBe(6);

    const log = await ctx.pool.query(`SELECT scl_result FROM th_scanlog ORDER BY scl_id`);
    expect(log.rows.map((r) => r.scl_result)).toEqual(['login_required', 'unknown', 'skipped', 'already_validated', 'validated']);
  });

  it('annonce une chasse pas encore commencée ou terminée (avec podium)', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.post(`/api/scan/${DEMO_TOKENS.lez[1]}`)).body.outcome).toBe('not_started');
    const closed = await seb.post(`/api/scan/${DEMO_TOKENS.palavas[2]}`);
    expect(closed.body.outcome).toBe('closed');
    expect(closed.body.podium.map((r: { teamName: string }) => r.teamName)).toEqual(['Les Goélands', 'Les Crabes Rieurs', 'Sable Chaud']);
  });

  it('passe l’organisatrice en mode test sans rien enregistrer', async () => {
    const camille = await loginAs(ctx.app, 'camille@example.com');
    const r = await camille.post(`/api/scan/${DEMO_TOKENS.nefles[1]}`);
    expect(r.body.outcome).toBe('organizer');
    expect(r.body.next.hintsRevealed).toHaveLength(3);
  });

  it('valide une seule fois une étape scannée en même temps par deux équipiers', async () => {
    const lea = await loginAs(ctx.app, 'lea@example.com');
    const hugo = await loginAs(ctx.app, 'hugo@example.com');
    const [a, b] = await Promise.all([lea.post(`/api/scan/${DEMO_TOKENS.nefles[4]}`), hugo.post(`/api/scan/${DEMO_TOKENS.nefles[4]}`)]);
    expect([a.body.outcome, b.body.outcome].sort()).toEqual(['already_validated', 'validated']);
  });

  it('arrête le chrono au scan de l’arrivée', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    const r = await seb.post(`/api/scan/${DEMO_TOKENS.nefles[5]}`);
    expect(r.body.outcome).toBe('validated');
    expect(r.body.step.isFinal).toBe(true);
    expect(r.body.team.finished).not.toBeNull();
    expect((await seb.post(`/api/scan/${DEMO_TOKENS.nefles[1]}`)).body.outcome).toBe('team_finished');
  });
});

describe('jokers', () => {
  it('dévoile les jokers un par un et applique la pénalité de leur niveau', async () => {
    const enzo = await loginAs(ctx.app, 'enzo@example.com'); // Les Mouettes, énigme vers l'étape 4
    const first = await enzo.post('/api/hunts/1/hints');
    expect(first.body.clue.hintsRevealed).toEqual(['Lattara.']);
    expect(first.body.penalty).toBe(2);
    const second = await enzo.post('/api/hunts/1/hints');
    expect(second.body.penalty).toBe(7); // 2 + 5
    expect((await enzo.post('/api/hunts/1/hints')).status).toBe(409); // plus de joker pour cette énigme
  });
});

describe('abandon d’épreuve (4ᵉ joker)', () => {
  it('passe à l’énigme suivante avec la pénalité d’abandon', async () => {
    const lucas = await loginAs(ctx.app, 'lucas@example.com'); // Cap au Sud : étape 1 trouvée, 2 jokers (2 + 5 min)
    const r = await lucas.post('/api/hunts/1/skip');
    expect(r.status).toBe(200);
    expect(r.body.clue.targetOrder).toBe(3);
    expect(r.body.validated.at(-1)).toMatchObject({ order: 2, skipped: true });
    expect(r.body.skipsUsed).toBe(1);
    expect(r.body.penalty).toBe(2 + 5 + 30);
    // Le QR de l'épreuve abandonnée n'apporte plus rien ; la suivante se valide normalement.
    expect((await lucas.post(`/api/scan/${DEMO_TOKENS.nefles[2]}`)).body.outcome).toBe('already_validated');
    expect((await lucas.post(`/api/scan/${DEMO_TOKENS.nefles[3]}`)).body.outcome).toBe('validated');
  });

  it('refuse d’abandonner l’arrivée', async () => {
    const nathan = await loginAs(ctx.app, 'nathan@example.com'); // Les Retardataires : aucune étape
    for (const target of [2, 3, 4, 5]) {
      expect((await nathan.post('/api/hunts/1/skip')).body.clue.targetOrder).toBe(target);
    }
    const last = await nathan.post('/api/hunts/1/skip');
    expect(last.status).toBe(409);
    expect(last.body.message).toMatch(/arrivée/);
    const live = (await (await loginAs(ctx.app, 'camille@example.com')).get('/api/hunts/1/live')).body;
    expect(live.find((row: { team: { name: string } }) => row.team.name === 'Les Retardataires').skips).toBe(4);
  });
});

describe('résultats', () => {
  it('réserve le classement complet à l’organisatrice pendant la course', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.get('/api/hunts/1/results')).status).toBe(403);
    const camille = await loginAs(ctx.app, 'camille@example.com');
    const r = await camille.get('/api/hunts/1/results');
    expect(r.status).toBe(200);
    // Team Boussole : 75 min sans joker ; Les Flibustiers : 73 min + 2 jokers de niveau 1 (2 × 2 min).
    expect(r.body[0].teamName).toBe('Team Boussole');
  });

  it('publie le classement à tous après la clôture', async () => {
    const r = await client(ctx.app).get('/api/hunts/3/results');
    expect(r.status).toBe(200);
    expect(r.body.filter((row: { rank: number | null }) => row.rank === null)).toHaveLength(2);
  });
});

describe('organisation d’une chasse, de la création au podium', () => {
  it('déroule tout le cycle de vie', async () => {
    const orga = await loginAs(ctx.app, 'camille@example.com');
    const begin = new Date(Date.now() + 3_600_000).toISOString();
    const end = new Date(Date.now() + 7_200_000).toISOString();

    const created = await orga.post('/api/hunts', {
      name: 'Test du temple',
      description: 'Chasse de test',
      location: 'Lattes',
      begin,
      end,
      startMode: 'staggered',
      interval: 10,
      hintPenalties: [1, 2, 3],
      teamGame: true,
      teamMin: 1,
      teamMax: 3,
    });
    expect(created.status).toBe(201);
    const huntId = created.body.id;
    expect(created.body.status).toBe('draft');
    expect(created.body.stepCount).toBe(1);

    // Parcours : départ, deux étapes, arrivée ; puis inversion des deux étapes.
    const s1 = (await orga.post(`/api/hunts/${huntId}/steps`, { title: 'Idole', instructions: 'Cherchez le rocher' })).body;
    const s2 = (await orga.post(`/api/hunts/${huntId}/steps`, { title: 'Rocher' })).body;
    const reordered = await orga.put(`/api/hunts/${huntId}/steps/order`, { stepIds: [s2.id, s1.id] });
    expect(reordered.body.map((s: { title: string }) => s.title)).toEqual(['Départ', 'Rocher', 'Idole', 'Arrivée']);
    await orga.patch(`/api/steps/${reordered.body[0].id}`, { instructions: 'Première énigme', hints: ['Un', 'Deux'] });

    // Un brouillon est invisible des joueurs.
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.get(`/api/hunts/${huntId}`)).status).toBe(404);
    expect((await orga.post(`/api/hunts/${huntId}/publish`)).body.status).toBe('published');

    // Inscriptions : deux équipes, un équipier qui rejoint par code.
    const team = await seb.post(`/api/hunts/${huntId}/teams`, { name: 'Les Aventuriers' });
    expect(team.status).toBe(201);
    const hugo = await loginAs(ctx.app, 'hugo@example.com');
    expect((await hugo.post('/api/teams/join', { code: team.body.joinCode })).body.members).toHaveLength(2);
    expect((await hugo.post(`/api/hunts/${huntId}/teams`, { name: 'Doublon' })).status).toBe(409);
    const ines = await loginAs(ctx.app, 'ines@example.com');
    const other = await ines.post(`/api/hunts/${huntId}/teams`, { name: 'Les Rivaux' });

    // Ordre de passage puis départ : la 2ᵉ équipe part 10 min après la 1ʳᵉ.
    await orga.put(`/api/hunts/${huntId}/teams/order`, { teamIds: [other.body.id, team.body.id] });
    expect((await orga.post(`/api/hunts/${huntId}/start`)).body.status).toBe('running');
    const teams = (await orga.get(`/api/hunts/${huntId}/teams`)).body;
    expect(Date.parse(teams[1].started) - Date.parse(teams[0].started)).toBe(10 * 60_000);
    expect((await orga.put(`/api/hunts/${huntId}/steps/order`, { stepIds: [s1.id, s2.id] })).status).toBe(409);

    // L'équipe de seb n'est pas encore partie ; celle d'Inès si.
    const tokens = (await orga.get(`/api/hunts/${huntId}/steps`)).body.map((s: { token: string }) => s.token);
    expect((await seb.post(`/api/scan/${tokens[1]}`)).body.outcome).toBe('team_not_started');
    expect((await ines.post(`/api/scan/${tokens[1]}`)).body.outcome).toBe('validated');

    // L'organisatrice retarde le départ des Aventuriers puis valide une étape à la main pour les Rivaux.
    const live = await orga.post(`/api/teams/${other.body.id}/validations`, { stepId: reordered.body[2].id });
    expect(live.body.find((r: { team: { id: number } }) => r.team.id === other.body.id).lastOrder).toBe(2);
    const manual = await ctx.pool.query(`SELECT val_source, val_by_htr FROM th_validations WHERE val_team_tea = $1 ORDER BY val_id`, [other.body.id]);
    expect(manual.rows.at(-1)).toEqual({ val_source: 'MANUAL', val_by_htr: 2 });
    expect((await orga.post(`/api/teams/${team.body.id}/delay`, { minutes: 5 })).status).toBe(200);

    // Arrivée des Rivaux puis clôture.
    expect((await ines.post(`/api/scan/${tokens[3]}`)).body.step.isFinal).toBe(true);
    expect((await orga.post(`/api/hunts/${huntId}/close`)).body.status).toBe('closed');
    expect((await ines.post(`/api/scan/${tokens[1]}`)).body.outcome).toBe('closed');
    const results = (await seb.get(`/api/hunts/${huntId}/results`)).body;
    expect(results.map((r: { teamName: string; rank: number | null }) => [r.teamName, r.rank])).toEqual([
      ['Les Rivaux', 1],
      ['Les Aventuriers', null],
    ]);
  });

  it('refuse les actions d’un non-organisateur', async () => {
    const seb = await loginAs(ctx.app, 'seb@example.com');
    expect((await seb.post('/api/hunts/2/start')).status).toBe(403);
    expect((await seb.get('/api/hunts/1/live')).status).toBe(403);
    expect((await client(ctx.app).post('/api/hunts', { name: 'x' })).status).toBe(400);
  });
});

describe('départs et clôtures automatiques', () => {
  it('démarre une chasse publiée à l’heure prévue', async () => {
    await ctx.pool.query(`UPDATE th_hunts SET hun_autostart = true, hun_begin = now() - interval '1 minute' WHERE hun_id = 2`);
    const { Service } = await import('../src/service.js');
    expect(await new Service(ctx.pool).runSchedule()).toBeGreaterThanOrEqual(1);
    const hunt = (await client(ctx.app).get('/api/hunts/2')).body;
    expect(hunt.status).toBe('running');
    const teams = (await client(ctx.app).get('/api/hunts/2/teams')).body;
    expect(new Set(teams.map((t: { started: string }) => t.started)).size).toBe(1); // départ groupé
  });
});
