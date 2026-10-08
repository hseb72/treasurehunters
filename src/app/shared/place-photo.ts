import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PhotoCredit } from '@shared/models';
import { AuthImage } from './auth-image';

/**
 * Photo du lieu choisie par l'organisateur (§ 18), montrée aux joueurs en tête d'énigme ou
 * à l'arrivée : un tirage papier posé sur le carnet, aux couleurs du skin.
 */
@Component({
  selector: 'th-place-photo',
  imports: [AuthImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure>
      <th-auth-image kind="illustration" [id]="stepId()" [alt]="alt()" />
      @if (caption()) {
        <figcaption class="small">{{ caption() }}</figcaption>
      }
      @if (credit(); as c) {
        <!-- Crédit exigé par la licence libre de la photo (§ 47). -->
        <figcaption class="credit">
          @if (c.url) {
            <a [href]="c.url" target="_blank" rel="noopener noreferrer">{{ c.text }}</a>
          } @else {
            {{ c.text }}
          }
        </figcaption>
      }
    </figure>
  `,
  styles: `
    :host { display: block; }
    figure {
      margin: 4px auto 10px; padding: 6px 6px 4px; max-width: 360px;
      background: var(--th-surface-raised); border: 1px solid var(--th-border); border-radius: 6px;
      box-shadow: 0 2px 8px color-mix(in srgb, var(--th-ink) 18%, transparent); transform: rotate(-1deg);
    }
    th-auth-image { aspect-ratio: 4 / 3; border-radius: 3px; }
    figcaption { padding: 4px 2px 0; text-align: center; font-family: var(--th-font-note); color: var(--th-ink-soft); }
    .credit { font: 0.68rem/1.3 var(--th-font-body); overflow-wrap: anywhere; }
    .credit a { color: inherit; }
    :host(.compact) figure { margin: 6px 0 0; max-width: 160px; transform: none; }
  `,
})
export class PlacePhoto {
  /** Étape dont on montre la photo. */
  readonly stepId = input.required<number>();
  readonly alt = input('Photo du lieu');
  readonly caption = input<string | null>(null);
  /** Auteur et licence d'une photo libre, affichés sous la photo. */
  readonly credit = input<PhotoCredit | null | undefined>(null);
}
