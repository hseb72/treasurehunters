import { ChangeDetectionStrategy, Component, computed, inject, model } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SKINS, skinById } from '@shared/skins';
import { SkinDirective, SkinEffects } from './skin';

/**
 * Choix du skin d'une chasse, avec un aperçu de ce que verront les joueurs : bandeau,
 * énigme, tampon, bouton, et le son de validation.
 */
@Component({
  selector: 'th-skin-picker',
  imports: [MatIconModule, SkinDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="skins" role="radiogroup" aria-label="Skin de la chasse">
      @for (s of skins; track s.id) {
        <button type="button" class="skin-card" role="radio" [attr.aria-checked]="value() === s.id" [class.on]="value() === s.id" (click)="value.set(s.id)">
          <img [src]="s.cover" alt="" />
          <span class="name">{{ s.name }}</span>
          <span class="price">{{ s.price ? (s.price / 100).toFixed(2).replace('.', ',') + ' €' : 'Offert' }}</span>
        </button>
      }
    </div>

    @let s = selected();
    <p class="small muted description">{{ s.description }}</p>
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
    .skin-card .price { padding: 0 10px; font-size: 0.8rem; color: var(--th-success); font-weight: 600; }
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
  protected readonly skins = SKINS;
  protected readonly fx = inject(SkinEffects);
  protected readonly selected = computed(() => skinById(this.value()));
}
