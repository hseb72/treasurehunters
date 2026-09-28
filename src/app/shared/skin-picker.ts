import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { SKINS, skinById } from '@shared/skins';
import { Notify } from '../core/notify';
import { Shop } from '../core/shop';
import { SkinCatalog } from '../core/skin-catalog';
import { SkinDirective, SkinEffects } from './skin';

/**
 * Choix du skin d'une chasse, avec un aperçu de ce que verront les joueurs : bandeau,
 * énigme, tampon, bouton, et le son de validation.
 */
@Component({
  selector: 'th-skin-picker',
  imports: [MatIconModule, RouterLink, SkinDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="skins" role="radiogroup" aria-label="Skin de la chasse">
      @for (s of skins(); track s.id) {
        @let owned = s.id === value() || shop.owns('skin:' + s.id);
        <button type="button" class="skin-card" role="radio" [attr.aria-checked]="value() === s.id" [class.on]="value() === s.id" (click)="choose(s.id)" [disabled]="busy()">
          <img [src]="s.cover" alt="" />
          <span class="name">{{ s.name }}</span>
          @if (creatorOf(s.id); as author) {
            <span class="by small muted">par {{ author }}</span>
          }
          @if (owned) {
            <span class="price">Dans votre collection</span>
          } @else {
            <span class="price locked"><mat-icon inline>lock_open</mat-icon> Obtenir — {{ shop.offer('skin:' + s.id) }}</span>
          }
        </button>
      }
    </div>

    @let s = selected();
    <p class="small muted description">{{ s.description }} <a routerLink="/store">Voir la boutique</a></p>
    <div class="preview" [thSkin]="s.id" aria-label="Aperçu du skin">
      <div class="banner preview-head">
        <span class="small muted">Aperçu joueur</span>
        <strong class="display">L'expédition commence</strong>
      </div>
      <div class="surface preview-card">
        <span class="stamp">Énigme n° 1</span>
        <p class="note">« Là où l'eau chante sans jamais se taire, cherchez la première trace. »</p>
        <div class="preview-actions">
          <span class="stamp stamp--success">Étape trouvée</span>
          <button type="button" class="try" (click)="fx.validated(s.id)"><mat-icon inline>volume_up</mat-icon> Écouter</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; }
    .skins { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
    .skin-card {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 0 0 8px;
      border: 2px solid var(--th-border); border-radius: 12px; background: var(--th-surface-raised);
      overflow: hidden; cursor: pointer; font: inherit; color: inherit; text-align: left;
    }
    .skin-card img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; margin-bottom: 4px; }
    .skin-card .name { padding: 0 10px; font-weight: 700; }
    .skin-card .by { padding: 0 10px; }
    .skin-card .price { padding: 0 10px; font-size: 0.8rem; color: var(--th-success); font-weight: 600; }
    .skin-card .price.locked { color: var(--th-primary-light); }
    .skin-card.on { border-color: var(--th-primary-light); box-shadow: 0 0 0 3px color-mix(in srgb, var(--th-primary-light) 25%, transparent); }
    .description { margin: 0; }
    .preview { min-height: 0; padding: 12px; border-radius: 12px; display: flex; flex-direction: column; gap: 10px; }
    .preview-head { display: flex; flex-direction: column; padding: 12px 14px; }
    .preview-head .display { font-size: 1.2rem; }
    .preview-card .note { margin: 10px 0; }
    .preview-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .try { border: 0; background: none; color: var(--th-secondary); cursor: pointer; font: inherit; font-size: 0.85rem; }
  `,
})
export class SkinPicker {
  readonly value = model.required<string>();
  private readonly catalog = inject(SkinCatalog);
  /** Univers intégrés, puis ceux de créateurs que l'organisateur possède (ou que la chasse porte déjà). */
  protected readonly skins = computed(() => {
    this.catalog.version();
    const creators = this.shop.items
      .value()
      .filter((i) => i.skin && (i.owned || i.ref === this.value()))
      .map((i) => i.skin!);
    return [...SKINS, ...creators];
  });
  protected readonly fx = inject(SkinEffects);
  protected readonly shop = inject(Shop);
  private readonly notify = inject(Notify);
  protected readonly selected = computed(() => (this.catalog.version(), skinById(this.value())));

  protected creatorOf(id: string): string | null {
    return this.shop.item(`skin:${id}`)?.creator?.nickname ?? null;
  }
  protected readonly busy = signal(false);

  /** Un univers pas encore obtenu l'est d'abord (offert pendant le lancement), puis choisi. */
  protected choose(id: string): void {
    if (id === this.value() || this.shop.owns(`skin:${id}`)) {
      this.value.set(id);
      return;
    }
    this.busy.set(true);
    this.shop.obtain(`skin:${id}`).subscribe({
      next: () => {
        this.busy.set(false);
        this.value.set(id);
        this.notify.info(`Univers « ${skinById(id).name} » ajouté à votre collection.`);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
}
