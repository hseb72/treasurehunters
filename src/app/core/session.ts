import { computed, Injectable, signal } from '@angular/core';
import { AuthResult, Hunter } from '@shared/models';

const STORAGE_KEY = 'th.session';

/** Joueur connecté et jeton de session (envoyé en « Authorization: Bearer »). */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly current = signal<AuthResult | null>(read());

  readonly user = computed(() => this.current()?.user ?? null);
  readonly token = computed(() => this.current()?.token ?? null);
  readonly loggedIn = computed(() => this.current() !== null);

  set(auth: AuthResult | null): void {
    this.current.set(auth);
    try {
      if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Stockage indisponible (navigation privée) : la session reste en mémoire.
    }
  }

  /** Met à jour le profil sans changer de jeton. */
  updateUser(user: Hunter): void {
    const auth = this.current();
    if (auth) this.set({ ...auth, user });
  }
}

function read(): AuthResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthResult) : null;
  } catch {
    return null;
  }
}
