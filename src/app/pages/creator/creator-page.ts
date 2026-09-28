import { ChangeDetectionStrategy, Component, inject, input, numberAttribute } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Creation } from '@shared/creations';
import { priceLabel } from '@shared/store';
import { HuntApi } from '../../core/api';
import { Shop } from '../../core/shop';

/** Page publique d'un créateur (§ 19) : ses skins et packs publiés. */
@Component({
  selector: 'th-creator-page',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page--wide stack">
      @if (page.value(); as p) {
        <header class="head">
          <span class="small muted">Créateur</span>
          <h1>{{ p.nickname }}</h1>
          <p class="muted">{{ p.creations.length }} création{{ p.creations.length > 1 ? 's' : '' }} publiée{{ p.creations.length > 1 ? 's' : '' }} dans la boutique.</p>
        </header>
        <div class="grid">
          @for (c of p.creations; track c.id) {
            <article class="surface creation">
              @if (c.cover) {
                <img class="cover" [src]="c.cover" alt="" loading="lazy" />
              } @else {
                <div class="pack-icon"><mat-icon>extension</mat-icon><span class="small">{{ c.puzzleCount }} énigmes prêtes à poser</span></div>
              }
              <h3>{{ c.name }}</h3>
              <p class="small muted">{{ c.kind === 'skin' ? 'Univers' : 'Pack d’énigmes' }} · {{ price(c) }}</p>
              <p class="small">{{ c.description }}</p>
              <div class="row">
                <span class="spacer"></span>
                @if (shop.owns(c.kind + ':u' + c.id)) {
                  <span class="have small"><mat-icon inline>check_circle</mat-icon> Dans votre collection</span>
                } @else {
                  <a mat-stroked-button routerLink="/store"><mat-icon>storefront</mat-icon>Voir dans la boutique</a>
                }
              </div>
            </article>
          } @empty {
            <p class="muted">Pas encore de création publiée.</p>
          }
        </div>
      } @else if (page.error()) {
        <p class="muted">Créateur introuvable.</p>
      }
    </div>
  `,
  styles: `
    .head h1 { margin: 0; font-weight: 800; }
    .head p { margin: 4px 0 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .creation { display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
    .creation h3, .creation p { margin: 0; }
    .cover { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; }
    .pack-icon { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; aspect-ratio: 16 / 9; border-radius: 8px; background: var(--th-surface-sunken); color: var(--th-primary); }
    .pack-icon mat-icon { width: 40px; height: 40px; font-size: 40px; }
    .row { display: flex; align-items: center; margin-top: auto; }
    .spacer { flex: 1; }
    .have { color: var(--th-success); font-weight: 600; }
  `,
})
export class CreatorPage {
  private readonly api = inject(HuntApi);
  protected readonly shop = inject(Shop);
  readonly id = input.required({ transform: numberAttribute });
  protected readonly page = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.getCreator(params) });
  protected readonly price = (c: Creation) => (c.price ? priceLabel({ price: c.price, included: false }) : 'Offert');
}
