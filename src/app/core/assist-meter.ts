import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AssistUsage } from '@shared/assist';
import { HuntApi } from './api';
import { Session } from './session';

/**
 * Décompte de l'assistant de rédaction (§ 25), partagé par l'éditeur et le profil : il se
 * recharge à la connexion, et chaque suggestion reçue le met à jour aussitôt.
 */
@Injectable({ providedIn: 'root' })
export class AssistMeter {
  private readonly api = inject(HuntApi);
  private readonly session = inject(Session);
  readonly usage = signal<AssistUsage | null>(null);

  constructor() {
    effect(() => {
      const user = this.session.user();
      untracked(() => (user ? this.reload() : this.usage.set(null)));
    });
  }

  reload(): void {
    this.api.assistUsage().subscribe({ next: (u) => this.usage.set(u), error: () => this.usage.set(null) });
  }
}
