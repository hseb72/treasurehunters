import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { Db, one } from './db.js';

export function hashPassword(password: string): Promise<string> {
  return hash(password); // argon2id, paramètres par défaut recommandés
}

export function verifyPassword(stored: string, password: string): Promise<boolean> {
  return verify(stored, password).catch(() => false);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Crée une session et renvoie le jeton en clair (seul son hash est stocké). */
export async function createSession(db: Db, hunterId: number, days: number, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO th_sessions (ses_hunter_htr, ses_tokenhash, ses_expires, ses_useragent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
    [hunterId, hashToken(token), days, userAgent?.slice(0, 255) ?? null],
  );
  return token;
}

/** Joueur associé à un jeton valide, ou null. */
export async function resolveSession(db: Db, token: string): Promise<number | null> {
  const row = await one(db, 'SELECT ses_hunter_htr FROM th_sessions WHERE ses_tokenhash = $1 AND ses_expires > now()', [hashToken(token)]);
  return row ? (row['ses_hunter_htr'] as number) : null;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM th_sessions WHERE ses_tokenhash = $1', [hashToken(token)]);
}
