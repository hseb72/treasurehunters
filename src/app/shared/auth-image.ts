import { ChangeDetectionStrategy, Component, DestroyRef, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { catchError, map, of } from 'rxjs';
import { HuntApi } from '../core/api';

/**
 * Photo servie par l'API, qui exige le jeton de connexion : une balise <img> ne sait
 * pas l'envoyer, on charge donc l'image en Blob et on l'affiche par une URL locale.
 */
@Component({
  selector: 'th-auth-image',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (url.value(); as src) {
      <img [src]="src" [alt]="alt()" loading="lazy" />
    } @else if (url.isLoading()) {
      <span class="placeholder"><mat-icon>hourglass_top</mat-icon></span>
    } @else {
      <span class="placeholder" [title]="'Photo indisponible'"><mat-icon>hide_image</mat-icon></span>
    }
  `,
  styles: `
    :host { display: block; overflow: hidden; border-radius: 4px; background: var(--th-parchment-dark); }
    img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .placeholder { display: grid; place-items: center; width: 100%; height: 100%; min-height: 80px; color: var(--th-ink-soft); }
  `,
})
export class AuthImage {
  private readonly api = inject(HuntApi);

  readonly kind = input.required<'photo' | 'reference'>();
  readonly id = input.required<number>();
  /** Change pour recharger l'image (nouvelle photo de référence, par exemple). */
  readonly version = input<unknown>(null);
  readonly alt = input('');

  private current: string | null = null;

  protected readonly url = rxResource({
    params: () => ({ kind: this.kind(), id: this.id(), version: this.version() }),
    stream: ({ params }) =>
      (params.kind === 'photo' ? this.api.photoImage(params.id) : this.api.referenceImage(params.id)).pipe(
        map((blob) => {
          if (this.current) URL.revokeObjectURL(this.current);
          return (this.current = URL.createObjectURL(blob));
        }),
        catchError(() => of(null)),
      ),
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.current && URL.revokeObjectURL(this.current));
  }
}
