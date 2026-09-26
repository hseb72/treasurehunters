import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { DIFFICULTY_LABELS } from '@shared/generation';
import { CatalogEntry } from '@shared/models';
import { Stars } from './stars';

/** Carte d'une chasse du catalogue : de quoi comparer avant d'ouvrir sa fiche. */
@Component({
  selector: 'th-catalog-card',
  imports: [MatIconModule, RouterLink, Stars],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let e = entry();
    <a class="parchment card" [routerLink]="['/catalog', e.id]">
      <h3>{{ e.title }}</h3>
      <div class="row small muted meta">
        <span class="row"><mat-icon>location_on</mat-icon>{{ e.location }}</span>
        <span class="row"><mat-icon>person_pin</mat-icon>{{ e.authorNickname }}</span>
      </div>
      <th-stars [value]="e.rating.stars" [count]="e.rating.count" />
      <div class="row small meta">
        <span class="row"><mat-icon>route</mat-icon>{{ e.stepCount }} étapes</span>
        <span class="row"><mat-icon>schedule</mat-icon>{{ e.measuredMinutes ?? e.durationMinutes }} min</span>
        <span class="row"><mat-icon>signpost</mat-icon>{{ difficulty[e.difficulty] }}</span>
        <span class="row"><mat-icon>{{ e.validation === 'geo' ? 'where_to_vote' : 'qr_code_2' }}</mat-icon>{{ e.validation === 'geo' ? 'géolocalisation' : 'QR codes' }}</span>
        <span class="row"><mat-icon>groups</mat-icon>{{ e.plays }} partie{{ e.plays > 1 ? 's' : '' }}</span>
      </div>
      @if (e.parent) {
        <div class="small muted"><mat-icon inline>call_split</mat-icon> Version de « {{ e.parent.title }} » par {{ e.parent.authorNickname }}</div>
      }
      @if (e.withdrawn) {
        <span class="badge badge--cancelled">retirée du catalogue</span>
      }
    </a>
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: 6px; height: 100%; }
    h3 { margin: 0; }
    .meta { flex-wrap: wrap; gap: 4px 14px; }
    .meta mat-icon { width: 18px; height: 18px; font-size: 18px; }
    .badge { align-self: flex-start; }
  `,
})
export class CatalogCard {
  readonly entry = input.required<CatalogEntry>();
  protected readonly difficulty = DIFFICULTY_LABELS;
}
