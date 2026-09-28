import { ChangeDetectionStrategy, Component, inject, Injectable, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Surprise } from '@shared/surprise';
import { HuntApi } from '../core/api';
import { currentPosition } from '../core/geo';
import { CatalogCard } from './catalog-card';

/** Temps disponible proposé, en minutes (0 : peu importe). */
const TIMES = [60, 120, 180, 0];

/**
 * « Surprends-moi » (§ 37) : « on est là, on a deux heures, qu'est-ce qu'on fait ? ». Le joueur
 * dit son temps, la position est demandée au téléphone (jamais enregistrée), et l'application
 * propose une Secret Track jouable en autonomie, avec ses raisons ; « Une autre » en retire une.
 */
@Component({
  selector: 'th-surprise-dialog',
  imports: [CatalogCard, MatButtonModule, MatButtonToggleModule, MatDialogModule, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title><mat-icon inline>casino</mat-icon> Surprends-moi</h2>
    <mat-dialog-content>
      <p class="label">Combien de temps avez-vous ?</p>
      <mat-button-toggle-group [value]="minutes()" (change)="minutes.set($event.value)" hideSingleSelectionIndicator aria-label="Temps disponible">
        @for (t of times; track t) {
          <mat-button-toggle [value]="t">{{ timeLabel(t) }}</mat-button-toggle>
        }
      </mat-button-toggle-group>
      <p class="small muted">
        @if (located()) {
          <mat-icon inline>my_location</mat-icon> Autour de vous, à moins de 20 km.
        } @else {
          Votre position sert à chercher près d'ici ; elle n'est pas enregistrée.
        }
      </p>

      @if (result(); as r) {
        @if (r.entry; as e) {
          <div class="pick">
            <th-catalog-card [entry]="e" />
            <ul class="reasons">
              @for (why of r.reasons; track why) {
                <li><mat-icon inline>check</mat-icon>{{ why }}</li>
              }
            </ul>
          </div>
        } @else {
          <p class="none">
            <mat-icon>travel_explore</mat-icon>
            {{ seen.length ? 'Plus d’autre idée avec ces critères.' : 'Aucune Secret Track jouable en autonomie ne correspond autour de vous.' }}
          </p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Fermer</button>
      @if (result()?.entry; as e) {
        <button mat-button type="button" (click)="draw(true)" [disabled]="busy()"><mat-icon>refresh</mat-icon>Une autre</button>
        <a mat-flat-button [routerLink]="['/catalog', e.id]" mat-dialog-close><mat-icon>arrow_forward</mat-icon>Voir la fiche</a>
      } @else {
        <button mat-flat-button type="button" (click)="draw(false)" [disabled]="busy()">
          <mat-icon>casino</mat-icon>{{ busy() ? 'Je cherche…' : result() ? 'Réessayer' : 'Trouve-moi une Secret Track' }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .label { font-weight: 600; color: var(--th-primary); margin: 0 0 6px; }
    .pick { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
    .reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.9rem; }
    .reasons mat-icon { color: var(--th-success); margin-right: 4px; }
    .none { display: flex; align-items: center; gap: 8px; color: var(--th-ink-soft); }
  `,
})
export class SurpriseDialog {
  private readonly api = inject(HuntApi);
  protected readonly times = TIMES;
  protected readonly minutes = signal(120);
  protected readonly located = signal(false);
  protected readonly busy = signal(false);
  protected readonly result = signal<Surprise | null>(null);
  /** Déjà proposées : « Une autre » ne les repropose pas. */
  protected seen: number[] = [];
  private near: { lat: number; lng: number } | undefined;

  protected timeLabel = (t: number): string => (t ? `${t / 60} h` : 'Peu importe');

  protected async draw(another: boolean): Promise<void> {
    this.busy.set(true);
    if (!another) this.seen = [];
    if (!this.near) {
      try {
        const p = await currentPosition();
        this.near = { lat: p.lat, lng: p.lng };
        this.located.set(true);
      } catch {
        // Sans position, on cherche dans tout le catalogue.
      }
    }
    this.api.surprise({ near: this.near, minutes: this.minutes() || undefined, exclude: this.seen }).subscribe({
      next: (r) => {
        if (r.entry) this.seen.push(r.entry.id);
        this.result.set(r);
        this.busy.set(false);
      },
      error: () => {
        this.result.set({ entry: null, reasons: [] });
        this.busy.set(false);
      },
    });
  }
}

@Injectable({ providedIn: 'root' })
export class SurpriseMe {
  private readonly dialog = inject(MatDialog);

  open(): void {
    this.dialog.open(SurpriseDialog, { maxWidth: '520px', width: '100%', autoFocus: false });
  }
}
