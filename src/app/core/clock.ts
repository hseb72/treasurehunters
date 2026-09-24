import { Injectable, signal } from '@angular/core';

/** Heure courante, rafraîchie chaque seconde (comptes à rebours et chronos). */
@Injectable({ providedIn: 'root' })
export class Clock {
  private readonly tick = signal(Date.now());
  readonly now = this.tick.asReadonly();

  constructor() {
    setInterval(() => this.tick.set(Date.now()), 1000);
  }
}
