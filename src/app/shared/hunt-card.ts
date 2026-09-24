import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Hunt } from '@shared/models';
import { START_MODE_LABELS } from './labels';
import { StatusBadge } from './status-badge';

/** Carte d'une chasse, façon affiche d'expédition. */
@Component({
  selector: 'th-hunt-card',
  imports: [DatePipe, MatIconModule, RouterLink, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="parchment card" [routerLink]="link() ?? ['/hunts', hunt().id]">
      <div class="head row">
        <th-status-badge [status]="hunt().status" />
        <span class="spacer"></span>
        <span class="date small">{{ hunt().begin | date: 'EEE d MMM · HH:mm' }}</span>
      </div>
      <h3>{{ hunt().name }}</h3>
      <div class="meta row small muted">
        <span class="row"><mat-icon>location_on</mat-icon>{{ hunt().location }}</span>
      </div>
      <div class="meta row small muted">
        <span class="row"><mat-icon>route</mat-icon>{{ hunt().stepCount }} étapes</span>
        <span class="row"><mat-icon>{{ hunt().teamGame ? 'groups' : 'person' }}</mat-icon>{{ hunt().teamCount }} {{ hunt().teamGame ? 'équipes' : 'joueurs' }}</span>
        <span class="row"><mat-icon>{{ hunt().startMode === 'mass' ? 'sprint' : 'timer' }}</mat-icon>{{ modes[hunt().startMode] }}</span>
      </div>
      @if (hunt().award) {
        <div class="award small"><mat-icon>diamond</mat-icon>{{ hunt().award }}</div>
      }
      <ng-content />
    </a>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: 6px; height: 100%; }
    h3 { margin: 4px 0 0; }
    .date { font-family: var(--th-font-note); color: var(--th-ink-soft); }
    .meta { gap: 4px 14px; }
    .meta .row { gap: 4px; }
    .mat-icon { width: 18px; height: 18px; font-size: 18px; }
    .award { display: flex; align-items: center; gap: 6px; margin-top: auto; padding-top: 8px;
      border-top: 1px dashed var(--th-edge); color: var(--th-saddle); font-style: italic; }
  `,
})
export class HuntCard {
  readonly hunt = input.required<Hunt>();
  readonly link = input<unknown[] | null>(null);
  protected readonly modes = START_MODE_LABELS;
}
