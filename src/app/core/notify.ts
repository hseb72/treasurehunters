import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({ providedIn: 'root' })
export class Notify {
  private readonly snack = inject(MatSnackBar);

  info(message: string, duration = 3500): void {
    this.snack.open(message, 'OK', { duration });
  }

  error(err: unknown): void {
    const message = err instanceof Error ? err.message : 'Une erreur est survenue.';
    this.snack.open(message, 'Fermer', { duration: 6000 });
  }
}
