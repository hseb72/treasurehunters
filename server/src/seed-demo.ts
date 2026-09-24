import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildFixtures } from '../../shared/fixtures.js';
import { hashPassword } from './auth.js';
import { config } from './config.js';
import { createPool, tx } from './db.js';
import { STATUS_IDS } from './repo.js';

const TABLES = ['th_scanlog', 'th_hintuses', 'th_validations', 'th_teamhunters', 'th_teams', 'th_codes', 'th_hunts', 'th_sessions', 'th_secrets', 'th_hunters'];

/**
 * Charge le jeu de démonstration des maquettes (shared/fixtures.ts) : mêmes comptes (mot de passe « demo »),
 * mêmes chasses, mêmes QR codes. Les dates sont calculées par rapport à maintenant.
 * Avec reset, vide d'abord les tables ; sinon refuse une base qui contient déjà des joueurs.
 */
export async function seedDemo(pool: pg.Pool, opts: { reset?: boolean; now?: number } = {}): Promise<void> {
  const db = buildFixtures(opts.now);
  const password = await hashPassword('demo');
  await tx(pool, async (c) => {
    if (opts.reset) await c.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    const existing = await c.query('SELECT count(*)::int AS n FROM th_hunters');
    if (existing.rows[0].n > 0) throw new Error('La base contient déjà des joueurs (utilisez --reset pour la vider).');

    const insert = (table: string, row: Record<string, unknown>) => {
      const cols = Object.keys(row);
      return c.query(
        `INSERT INTO ${table} (${cols.join(', ')}) OVERRIDING SYSTEM VALUE VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(row),
      );
    };

    for (const h of db.hunters) {
      await insert('th_hunters', { htr_id: h.id, htr_nickname: h.nickname, htr_email: h.email });
      await c.query('INSERT INTO th_secrets (sec_hunter_htr, sec_password) VALUES ($1, $2)', [h.id, password]);
    }
    for (const h of db.hunts) {
      await insert('th_hunts', {
        hun_id: h.id,
        hun_owner_htr: h.ownerId,
        hun_name: h.name,
        hun_description: h.description,
        hun_location: h.location,
        hun_begin: h.begin,
        hun_end: h.end,
        hun_started: h.started,
        hun_closed: h.closed,
        hun_autostart: h.autoStart,
        hun_autoclose: h.autoClose,
        hun_award: h.award,
        hun_starttext: h.startText,
        hun_startmode: h.startMode === 'staggered' ? 2 : 1,
        hun_interval: h.interval,
        hun_penalty1: h.hintPenalties[0],
        hun_penalty2: h.hintPenalties[1],
        hun_penalty3: h.hintPenalties[2],
        hun_teamgame: h.teamGame,
        hun_teammin: h.teamMin,
        hun_teammax: h.teamMax,
        hun_public: h.isPublic,
        hun_joincode: h.joinCode,
        hun_contribution: h.contribution,
        hun_status_hst: STATUS_IDS[h.status],
      });
    }
    for (const s of db.steps) {
      await insert('th_codes', {
        cod_id: s.id,
        cod_hunt_hun: s.huntId,
        cod_order: s.order,
        cod_longid: s.token,
        cod_title: s.title,
        cod_arrival: s.arrival,
        cod_instructions: s.instructions,
        cod_hint1: s.hints[0] ?? null,
        cod_hint2: s.hints[1] ?? null,
        cod_hint3: s.hints[2] ?? null,
        cod_address: s.address,
      });
    }
    for (const t of db.teams) {
      await insert('th_teams', {
        tea_id: t.id,
        tea_hunt_hun: t.huntId,
        tea_name: t.name,
        tea_owner_htr: t.ownerId,
        tea_joincode: t.joinCode,
        tea_solo: t.solo,
        tea_startorder: t.startOrder,
        tea_started: t.started,
        tea_finished: t.finished,
      });
      for (const m of t.members) {
        await c.query('INSERT INTO th_teamhunters (thr_team_tea, thr_hunt_hun, thr_hunter_htr) VALUES ($1, $2, $3)', [t.id, t.huntId, m.hunterId]);
      }
    }
    for (const v of db.validations) {
      await c.query('INSERT INTO th_validations (val_team_tea, val_code_cod, val_hunter_htr, val_creation) VALUES ($1, $2, $3, $4)', [
        v.teamId,
        v.stepId,
        v.hunterId,
        v.at,
      ]);
    }
    for (const u of db.hintUses) {
      await c.query('INSERT INTO th_hintuses (hiu_team_tea, hiu_code_cod, hiu_level, hiu_hunter_htr, hiu_creation) VALUES ($1, $2, $3, $4, $5)', [
        u.teamId,
        u.stepId,
        u.level,
        u.hunterId,
        u.at,
      ]);
    }
    // Les séquences d'identité reprennent après les identifiants insérés.
    for (const [table, col] of [
      ['th_hunters', 'htr_id'],
      ['th_hunts', 'hun_id'],
      ['th_codes', 'cod_id'],
      ['th_teams', 'tea_id'],
    ]) {
      await c.query(`SELECT setval(pg_get_serial_sequence('${table}', '${col}'), (SELECT max(${col}) FROM ${table}))`);
    }
  });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const pool = createPool(config.databaseUrl);
  seedDemo(pool, { reset: process.argv.includes('--reset') })
    .then(() => console.log('Jeu de démonstration chargé (comptes seb@example.com / camille@example.com, mot de passe « demo »).'))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
