import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PlayState } from '@shared/models';

/** Point de départ d'une chasse (étape 0), avec un lien vers la carte. */
@Component({
  selector: 'th-start-place',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = start();
    <mat-icon>flag</mat-icon>
    <span>
      Point de départ :
      @if (s.name) {
        <strong>{{ s.name }}</strong>
      }
      <a [href]="mapUrl()" target="_blank" rel="noopener">voir sur la carte</a>
    </span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      gap: 6px;
      text-align: left;
    }
    mat-icon { color: var(--th-brick); flex: none; }
    a { margin-left: 0.3em; white-space: nowrap; }
  `,
})
export class StartPlace {
  readonly start = input.required<NonNullable<PlayState['start']>>();

  protected readonly mapUrl = computed(() => {
    const { lat, lng } = this.start();
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
  });
}
