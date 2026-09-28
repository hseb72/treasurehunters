import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { applyOffline, OfflineEvent, offlineHash, OfflinePack, OfflineProgress, offlineView } from '@shared/offline';
import { HuntApi } from './api';
import { Notify } from './notify';

/** Ce que garde le téléphone pour une chasse : le paquet, la progression locale, les actions en attente. */
export interface OfflineEntry {
  pack: OfflinePack;
  progress: OfflineProgress;
  events: OfflineEvent[];
}

const PREFIX = 'th-offline-';

/** Une action, sans son identifiant ni (au besoin) son heure : ajoutés à l'enregistrement. */
type NewOfflineEvent = OfflineEvent extends infer E ? (E extends OfflineEvent ? Omit<E, 'id' | 'at'> & { at?: string } : never) : never;

/**
 * Mode hors ligne (§ 32) : paquets enregistrés sur le téléphone, actions jouées sans réseau,
 * et synchronisation dès que le réseau revient (événement « online », ou ouverture de l'appli).
 */
@Injectable({ providedIn: 'root' })
export class OfflineStore {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  readonly entries = signal<Record<number, OfflineEntry>>(readAll());
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly syncing = signal(false);

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => {
      this.online.set(true);
      void this.syncAll();
    });
    window.addEventListener('offline', () => this.online.set(false));
    if (navigator.onLine) void this.syncAll();
  }

  get(huntId: number): OfflineEntry | null {
    return this.entries()[huntId] ?? null;
  }

  pending(huntId: number): number {
    return this.get(huntId)?.events.length ?? 0;
  }

  /** Télécharge (ou rafraîchit) le paquet ; les actions encore en attente sont d'abord synchronisées. */
  async prepare(huntId: number): Promise<void> {
    if (this.pending(huntId)) await this.sync(huntId);
    const pack = await firstValueFrom(this.api.getOfflinePack(huntId));
    this.save(huntId, { pack, progress: pack.progress, events: this.get(huntId)?.events ?? [] });
  }

  discard(huntId: number): void {
    this.save(huntId, null);
  }

  /** Une action jouée sans réseau : appliquée à la progression locale, mise en attente. */
  record(huntId: number, event: NewOfflineEvent): void {
    const entry = this.get(huntId);
    if (!entry) return;
    const full = { ...event, id: newId(), at: event.at ?? new Date().toISOString() } as OfflineEvent;
    this.save(huntId, { ...entry, progress: applyOffline(entry.pack, entry.progress, full), events: [...entry.events, full] });
  }

  /** QR scanné sans réseau : est-ce le lieu cherché d'une chasse enregistrée ? */
  async scanToken(token: string): Promise<{ huntId: number; title: string; isFinal: boolean; arrival: string | null; puzzle: boolean } | null> {
    for (const [id, entry] of Object.entries(this.entries())) {
      const view = offlineView(entry.pack, entry.progress);
      const t = view.target;
      if (entry.pack.validation !== 'qr' || view.phase !== 'playing' || !t?.tokenHash) continue;
      if ((await offlineHash(t.stepId, token)) !== t.tokenHash) continue;
      this.record(Number(id), { kind: 'scan', stepId: t.stepId, token });
      return { huntId: Number(id), title: t.title, isFinal: t.order === view.finalOrder, arrival: t.arrival, puzzle: !!t.puzzle };
    }
    return null;
  }

  async syncAll(): Promise<void> {
    for (const id of Object.keys(this.entries()).map(Number)) if (this.pending(id)) await this.sync(id);
  }

  /** Rejoue les actions en attente ; en cas de refus, la progression est reprise sur celle du serveur. */
  async sync(huntId: number): Promise<boolean> {
    const entry = this.get(huntId);
    if (!entry?.events.length) return true;
    this.syncing.set(true);
    try {
      const r = await firstValueFrom(this.api.offlineSync(huntId, entry.events));
      const current = this.get(huntId)!;
      const rest = current.events.slice(r.rejected ? current.events.length : r.applied);
      if (r.rejected) this.notify.error(new Error(`Une action jouée hors ligne a été refusée : ${r.rejected.reason}`));
      else this.notify.info('Partie synchronisée : vos actions hors ligne sont enregistrées.');
      this.save(huntId, { ...current, events: rest });
      // Progression de référence : celle du serveur.
      if (!rest.length) {
        const pack = await firstValueFrom(this.api.getOfflinePack(huntId)).catch(() => null);
        if (pack) this.save(huntId, { pack, progress: pack.progress, events: [] });
      }
      return !r.rejected;
    } catch (e) {
      // Toujours pas de réseau : on garde tout pour la prochaine fois.
      if (!(e instanceof HttpErrorResponse && e.status === 0)) this.notify.error(e);
      return false;
    } finally {
      this.syncing.set(false);
    }
  }

  private save(huntId: number, entry: OfflineEntry | null): void {
    this.entries.update((all) => {
      const next = { ...all };
      if (entry) next[huntId] = entry;
      else delete next[huntId];
      return next;
    });
    try {
      if (entry) localStorage.setItem(PREFIX + huntId, JSON.stringify(entry));
      else localStorage.removeItem(PREFIX + huntId);
    } catch {
      // stockage plein ou indisponible : le paquet vit le temps de la page
    }
  }
}

function readAll(): Record<number, OfflineEntry> {
  const all: Record<number, OfflineEntry> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const entry = JSON.parse(localStorage.getItem(key)!) as OfflineEntry;
      all[Number(key.slice(PREFIX.length))] = entry;
    }
  } catch {
    // stockage indisponible
  }
  return all;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
