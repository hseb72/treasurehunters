import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { DIFFICULTY_LABELS, minutesLabel, TRAVEL_ICONS, TRAVEL_LABELS, TRAVEL_MEANS } from '@shared/generation';
import { CatalogEntry } from '@shared/models';
import { skinById } from '@shared/skins';
import { SkinCatalog } from '../core/skin-catalog';
import { Shop } from '../core/shop';
import { priceLabel } from '@shared/store';
import { Stars } from './stars';
import { distanceLabel } from './distance';
import { PRACTICAL_TAGS, PracticalTag } from '@shared/practical';

/** Carte d'une chasse du catalogue : de quoi comparer avant d'ouvrir sa fiche. */
@Component({
  selector: 'th-catalog-card',
  imports: [MatIconModule, RouterLink, Stars],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let e = entry();
    <a class="surface card" [routerLink]="['/catalog', e.id]">
      <img class="cover" [src]="cover()" alt="" loading="lazy" />
      <div class="travel travel--{{ e.travel }}" [attr.aria-label]="'Déplacement : ' + means[e.travel]">
        <mat-icon>{{ icons[e.travel] }}</mat-icon>
        <strong>{{ means[e.travel] }}</strong>
        <span>· {{ formula[e.travel] }}</span>
        <span class="spacer"></span>
        <mat-icon>schedule</mat-icon>
        <strong>{{ minutes(e.durationMinutes) }}</strong>
      </div>
      <h3>{{ e.title }}</h3>
      @if (e.validation === 'geo') {
        <span class="autonomy small" title="Seul ou en famille, sans organisateur : départ sur place quand vous voulez"><mat-icon inline>hiking</mat-icon> Jouable en autonomie</span>
      }
      <div class="row small muted meta">
        <span class="row"><mat-icon>location_on</mat-icon>{{ e.location }}</span>
        @if (e.distanceKm !== null) {
          <span class="row distance" title="Distance à vol d'oiseau jusqu'au départ"><mat-icon>near_me</mat-icon>{{ distance(e.distanceKm) }}</span>
        }
        <span class="row"><mat-icon>person_pin</mat-icon>{{ e.authorNickname }}</span>
      </div>
      <th-stars [value]="e.rating.stars" [count]="e.rating.count" />
      <div class="row small meta">
        <span class="row"><mat-icon>route</mat-icon>{{ e.stepCount }} étapes</span>
        @if (e.measuredMinutes !== null) {
          <span class="row" title="Durée moyenne des équipes arrivées"><mat-icon>timer</mat-icon>jouée en {{ minutes(e.measuredMinutes) }}</span>
        }
        <span class="row"><mat-icon>signpost</mat-icon>Énigmes {{ difficulty[e.difficulty].toLowerCase() }}</span>
        <span class="row"><mat-icon>{{ e.validation === 'geo' ? 'where_to_vote' : 'qr_code_2' }}</mat-icon>{{ e.validation === 'geo' ? 'géolocalisation' : 'QR codes' }}</span>
        <span class="row"><mat-icon>groups</mat-icon>{{ e.plays }} partie{{ e.plays > 1 ? 's' : '' }}</span>
        @if (e.minAge) {
          <span class="row"><mat-icon>child_care</mat-icon>dès {{ e.minAge }} ans</span>
        }
        @for (t of practicalOf(e.practical); track t.id) {
          <span class="row" [title]="t.hint"><mat-icon>{{ t.icon }}</mat-icon>{{ t.label }}</span>
        }
        @if (e.price && shop.payments()) {
          <span class="row price"><mat-icon>sell</mat-icon>{{ priceOf(e.price) }}</span>
        }
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
    .card { display: flex; flex-direction: column; gap: 6px; height: 100%; overflow: hidden; }
    .cover { display: block; width: calc(100% + 32px); margin: -16px -16px 0; aspect-ratio: 16 / 7; max-height: 170px; object-fit: cover; }
    h3 { margin: 0; }
    .distance { color: var(--th-primary); font-weight: 600; }
    .price { color: var(--th-primary); font-weight: 700; }
    .autonomy { align-self: flex-start; padding: 2px 8px; border-radius: 999px; font-weight: 600; color: var(--th-success); background: color-mix(in srgb, var(--th-success) 12%, transparent); }
    .meta { flex-wrap: wrap; gap: 4px 14px; }
    .meta mat-icon { width: 18px; height: 18px; font-size: 18px; }
    .badge { align-self: flex-start; }
    .travel {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: -18px -4px 2px;
      position: relative;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 0.9rem;
      color: var(--th-surface-raised);
      background: var(--th-success);
      mat-icon { width: 20px; height: 20px; font-size: 20px; }
      span { opacity: 0.85; }
      .spacer { flex: 1; }
    }
    .travel--active { background: var(--th-secondary); }
    .travel--motor { background: var(--th-danger); }
  `,
})
export class CatalogCard {
  readonly entry = input.required<CatalogEntry>();
  private readonly skins = inject(SkinCatalog);
  protected readonly shop = inject(Shop);
  protected readonly priceOf = (cents: number) => priceLabel({ price: cents, included: false });
  protected readonly cover = computed(() => (this.skins.version(), this.skins.ensure(this.entry().skin), skinById(this.entry().skin).cover));
  protected readonly difficulty = DIFFICULTY_LABELS;
  protected readonly icons = TRAVEL_ICONS;
  protected readonly means = TRAVEL_MEANS;
  protected readonly formula = TRAVEL_LABELS;
  protected readonly minutes = minutesLabel;
  protected readonly distance = distanceLabel;
  protected readonly practicalOf = (ids: PracticalTag[]) => PRACTICAL_TAGS.filter((t) => ids.includes(t.id));
}
