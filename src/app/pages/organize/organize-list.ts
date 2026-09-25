import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { HuntApi } from '../../core/api';
import { HuntCard } from '../../shared/hunt-card';

@Component({
  selector: 'th-organize-list',
  imports: [MatButtonModule, MatIconModule, RouterLink, HuntCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page--wide stack">
      <header class="leather head">
        <div>
          <h1 class="display">Mes expéditions</h1>
          <p class="muted">Tracez le parcours, cachez les indices, lâchez les aventuriers.</p>
        </div>
        <div class="head-actions">
          <a mat-stroked-button routerLink="/generate"><mat-icon>auto_awesome</mat-icon>Inventer avec l'IA</a>
          <a mat-flat-button class="th-cta new" routerLink="/organize/new"><mat-icon>add_location_alt</mat-icon>Nouvelle chasse</a>
        </div>
      </header>
      <div class="grid">
        @for (hunt of hunts.value(); track hunt.id) {
          <th-hunt-card [hunt]="hunt" [link]="['/organize', hunt.id]" />
        } @empty {
          @if (!hunts.isLoading()) {
            <div class="parchment center empty">
              <p>Vous n'avez encore organisé aucune expédition.</p>
              <a mat-stroked-button routerLink="/organize/new">Créer ma première chasse</a>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: `
    .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 20px; }
    .head h1 { margin: 0; }
    .head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .head-actions .mat-mdc-outlined-button { --mat-button-outlined-label-text-color: var(--th-gold-light); --mat-button-outlined-outline-color: var(--th-gold); }
    .head p { margin: 4px 0 0; }
    .new { --mat-button-filled-container-color: var(--th-gold); --mat-button-filled-label-text-color: var(--th-leather); }
    .empty { grid-column: 1 / -1; }
  `,
})
export class OrganizeListPage {
  private readonly api = inject(HuntApi);
  protected readonly hunts = rxResource({ stream: () => this.api.listHunts('organized'), defaultValue: [] });
}
