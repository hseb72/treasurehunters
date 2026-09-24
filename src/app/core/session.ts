import { computed, Injectable, signal } from '@angular/core';
import { Hunter } from './models';

const STORAGE_KEY = 'th.hunter';

/** Joueur connecté. Le jeton de session viendra s'ajouter ici avec le vrai back-end. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly current = signal<Hunter | null>(read());

  readonly user = this.current.asReadonly();
  readonly loggedIn = computed(() => this.current() !== null);

  set(user: Hunter | null): void {
    this.current.set(user);
    try {
      if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Stockage indisponible (navigation privée) : la session reste en mémoire.
    }
  }
}

function read(): Hunter | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Hunter) : null;
  } catch {
    return null;
  }
}
