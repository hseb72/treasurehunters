import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Piste de progression façon carte au trésor : une borne par étape à trouver,
 * la dernière marquée d'une croix.
 */
@Component({
  selector: 'th-trail',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="trail" [attr.aria-label]="done() + ' étapes validées sur ' + total()">
      @for (m of markers(); track m.order) {
        <li class="marker marker--{{ m.state }}" [attr.aria-current]="m.state === 'current' ? 'step' : null">
          @if (m.final) {
            <mat-icon>close</mat-icon>
          } @else if (m.state === 'skipped') {
            <mat-icon>skip_next</mat-icon>
          } @else if (m.state === 'done') {
            <mat-icon>check</mat-icon>
          } @else {
            {{ m.order }}
          }
        </li>
      }
    </ol>
  `,
  styleUrl: './trail.scss',
})
export class Trail {
  /** Nombre d'étapes à trouver (arrivée comprise). */
  readonly total = input.required<number>();
  /** Nombre d'étapes validées. */
  readonly done = input.required<number>();
  /** Ordres des épreuves abandonnées (« 4ᵉ joker »). */
  readonly skipped = input<number[]>([]);
  /** Affiche la borne suivante comme « en cours ». */
  readonly active = input(true);

  protected readonly markers = computed(() =>
    Array.from({ length: this.total() }, (_, i) => {
      const order = i + 1;
      const state =
        order <= this.done()
          ? this.skipped().includes(order)
            ? 'skipped'
            : 'done'
          : order === this.done() + 1 && this.active()
            ? 'current'
            : 'todo';
      return { order, state, final: order === this.total() };
    }),
  );
}
