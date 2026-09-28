/**
 * Mode hors ligne (docs/conception.md § 32) : avant d'entrer dans une zone sans réseau, l'équipe
 * enregistre sur son téléphone le reste du parcours (« paquet hors ligne »). Le carnet continue
 * alors sans réseau : arrivées par géolocalisation, QR scannés, jokers, abandons et épreuves sont
 * vérifiés sur place et mis en attente, puis rejoués par le serveur au retour du réseau, avec
 * leurs heures réelles. Le serveur revérifie tout : rien ne compte sans lui.
 */
import type { PublicPuzzle } from './puzzles.js';

export interface OfflineStep {
  stepId: number;
  order: number;
  /** Nom du lieu, montré une fois trouvé. */
  title: string;
  arrival: string | null;
  /** Énigme qui mène à l'étape suivante (null pour l'arrivée). */
  instructions: string | null;
  hints: string[];
  lat: number | null;
  lng: number | null;
  entrances: { lat: number; lng: number }[];
  /** Chasse à QR : empreinte du jeton du QR posé sur le lieu (le jeton lui-même reste secret). */
  tokenHash: string | null;
  puzzle: PublicPuzzle | null;
  /** Empreintes des réponses acceptées à l'épreuve d'arrivée. */
  answerHashes: string[] | null;
}

/** Où en est l'équipe (au téléchargement, puis tenu à jour sur le téléphone). */
export interface OfflineProgress {
  started: string | null;
  /** Étapes validées, dans l'ordre. */
  validated: { order: number; at: string; skipped: boolean }[];
  /** Jokers pris, par étape (id de l'étape dont l'énigme est en cours). */
  hints: Record<number, number>;
  /** Épreuve d'arrivée qui attend sa réponse. */
  puzzle: { stepId: number; attempts: number } | null;
}

export interface OfflinePack {
  huntId: number;
  huntName: string;
  skin: string;
  teamName: string;
  validation: 'qr' | 'geo';
  geoRadius: number;
  /** L'équipe peut donner elle-même le départ (chasse surprise « chacun son chrono »). */
  selfStart: boolean;
  steps: OfflineStep[];
  progress: OfflineProgress;
  downloaded: string;
}

/** Une action jouée sans réseau ; `id` (unique) évite de la compter deux fois si elle est renvoyée. */
export type OfflineEvent = { id: string; at: string } & (
  | { kind: 'start' }
  | { kind: 'arrive'; stepId: number; lat: number; lng: number; accuracy: number }
  | { kind: 'scan'; stepId: number; token: string }
  | { kind: 'hint'; stepId: number }
  | { kind: 'skip'; stepId: number }
  | { kind: 'answer'; stepId: number; answer: string }
);

export interface OfflineSyncResult {
  /** Actions acceptées par le serveur, dans l'ordre. */
  applied: number;
  /** Première action refusée, et pourquoi ; les suivantes ne sont pas rejouées. */
  rejected: { index: number; reason: string } | null;
}

/** Empreinte SHA-256 (hexadécimal) d'un jeton ou d'une réponse, liée à son étape. */
export async function offlineHash(stepId: number, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${stepId}:${value}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ce que montre le carnet hors ligne, à partir du paquet et de la progression. */
export interface OfflineView {
  phase: 'waiting' | 'playing' | 'puzzle' | 'finished';
  /** Étape dont l'énigme est en cours (le départ, puis chaque lieu trouvé). */
  current: OfflineStep | null;
  target: OfflineStep | null;
  hintsRevealed: string[];
  canSkip: boolean;
  finalOrder: number;
}

export function offlineView(pack: OfflinePack, p: OfflineProgress): OfflineView {
  const finalOrder = pack.steps.reduce((m, s) => Math.max(m, s.order), 0);
  const last = p.validated.reduce((m, v) => Math.max(m, v.order), 0);
  const current = pack.steps.find((s) => s.order === last) ?? null;
  const target = pack.steps.find((s) => s.order === last + 1) ?? null;
  const phase = !p.started ? 'waiting' : last >= finalOrder ? 'finished' : p.puzzle ? 'puzzle' : 'playing';
  const used = current ? (p.hints[current.stepId] ?? 0) : 0;
  return {
    phase,
    current,
    target: phase === 'finished' ? null : target,
    hintsRevealed: current ? current.hints.slice(0, used) : [],
    canSkip: !!target && target.order < finalOrder,
    finalOrder,
  };
}

/**
 * Applique une action à la progression locale (les vérifications de position, de QR et de
 * réponse sont faites avant, par l'appelant). Renvoie la nouvelle progression.
 */
export function applyOffline(pack: OfflinePack, p: OfflineProgress, e: OfflineEvent): OfflineProgress {
  const view = offlineView(pack, p);
  const next: OfflineProgress = structuredClone(p);
  switch (e.kind) {
    case 'start':
      next.started = e.at;
      break;
    case 'hint':
      if (view.current) next.hints[view.current.stepId] = (next.hints[view.current.stepId] ?? 0) + 1;
      break;
    case 'skip':
      if (view.target) next.validated.push({ order: view.target.order, at: e.at, skipped: true });
      break;
    case 'arrive':
    case 'scan':
      if (!view.target) break;
      if (view.target.puzzle) next.puzzle = { stepId: view.target.stepId, attempts: 0 };
      else next.validated.push({ order: view.target.order, at: e.at, skipped: false });
      break;
    case 'answer':
      if (view.target && next.puzzle) {
        next.puzzle = null;
        next.validated.push({ order: view.target.order, at: e.at, skipped: false });
      }
      break;
  }
  return next;
}
