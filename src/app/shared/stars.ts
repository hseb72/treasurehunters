import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

/**
 * Note sur 5 en étoiles, fractions comprises (4,7 remplit 94 % de la rangée), avec le nombre
 * d'avis. Des caractères ★ plutôt que des icônes : la police d'icônes n'a pas de variante pleine.
 */
@Component({
  selector: 'th-stars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="stars" [attr.aria-label]="label()" role="img">
      <span class="bg" aria-hidden="true">★★★★★</span>
      <span class="fg" aria-hidden="true" [style.width.%]="percent()">★★★★★</span>
    </span>
    @if (value() !== null) {
      <span class="value">{{ value()!.toFixed(1) }}</span>
    }
    @if (count() !== null) {
      <span class="count">({{ count() }} avis)</span>
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 6px; }
    .stars { position: relative; display: inline-block; font-size: 1.15em; line-height: 1; letter-spacing: 1px; white-space: nowrap; }
    .bg { color: var(--th-edge); }
    .fg { position: absolute; inset: 0 auto 0 0; overflow: hidden; color: var(--th-gold); }
    .value { font-weight: 600; }
    .count { opacity: 0.75; font-size: 0.85em; }
  `,
})
export class Stars {
  readonly value = input<number | null>(null);
  readonly count = input<number | null>(null);
  protected readonly percent = computed(() => Math.max(0, Math.min(100, ((this.value() ?? 0) / 5) * 100)));
  protected readonly label = computed(() => (this.value() === null ? 'Pas encore noté' : `${this.value()} sur 5`));
}

/** Choix d'une note de 1 à 5. */
@Component({
  selector: 'th-star-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="label">{{ label() }}</span>
    <span class="picker" role="radiogroup" [attr.aria-label]="label()">
      @for (i of [1, 2, 3, 4, 5]; track i) {
        <button type="button" role="radio" [class.on]="(value() ?? 0) >= i" [attr.aria-checked]="value() === i" [attr.aria-label]="i + ' sur 5'" (click)="value.set(i)">★</button>
      }
    </span>
  `,
  styles: `
    :host { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .picker { display: inline-flex; }
    button { padding: 0 3px; border: 0; background: none; font-size: 30px; line-height: 1; color: var(--th-edge); cursor: pointer; }
    button.on { color: var(--th-gold); }
  `,
})
export class StarInput {
  readonly label = input.required<string>();
  readonly value = model<number | null>(null);
}
