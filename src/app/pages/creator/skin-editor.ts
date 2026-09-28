import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { SkinContent } from '@shared/creations';
import { registerSkin, SKINS, SkinManifest, SkinToken, skinById } from '@shared/skins';
import { Notify } from '../../core/notify';
import { compressPhoto } from '../../core/photo';
import { SkinDirective, SkinEffects } from '../../shared/skin';

/** Couleurs principales proposées à l'édition ; les autres jetons restent ceux de l'univers de départ (ou du manifeste). */
const COLORS: { token: SkinToken; label: string }[] = [
  { token: 'page-bg', label: 'Fond de page' },
  { token: 'ink', label: 'Texte' },
  { token: 'ink-soft', label: 'Texte discret' },
  { token: 'surface', label: 'Cartes' },
  { token: 'surface-ink', label: 'Texte des cartes' },
  { token: 'border', label: 'Bordures' },
  { token: 'primary', label: 'Couleur principale' },
  { token: 'primary-light', label: 'Principale claire' },
  { token: 'secondary', label: 'Secondaire' },
  { token: 'accent', label: 'Accent (tampons)' },
  { token: 'cta', label: 'Bouton d’action' },
  { token: 'on-cta', label: 'Texte du bouton' },
  { token: 'heading-ink', label: 'Titres' },
  { token: 'success', label: 'Réussite' },
  { token: 'danger', label: 'Alerte' },
];

/** Polices livrées avec l'application (celles des univers intégrés). */
const FONTS = [...new Set(SKINS.flatMap((s) => [s.tokens['font-title'], s.tokens['font-body']]).filter((f): f is string => !!f))];

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>${body}</svg>`)}`;

/** Couverture dessinée d'après les couleurs du skin, quand le créateur n'importe pas d'image. */
export function drawnCover(tokens: SkinContent['tokens']): string {
  const hex = (t: SkinToken, d: string) => (/^#[0-9a-f]{3,8}$/i.test(tokens[t] ?? '') ? tokens[t]! : d);
  return svg(
    `<rect width='320' height='180' fill='${hex('page-bg', '#f4efe4')}'/>` +
      `<rect x='40' y='30' width='240' height='120' rx='12' fill='${hex('surface', '#fffaf0')}' stroke='${hex('border', '#c9b99a')}' stroke-width='3'/>` +
      `<rect x='64' y='54' width='120' height='14' rx='7' fill='${hex('heading-ink', hex('primary', '#7a4a1e'))}'/>` +
      `<rect x='64' y='80' width='190' height='8' rx='4' fill='${hex('ink-soft', '#8a7a66')}'/><rect x='64' y='96' width='160' height='8' rx='4' fill='${hex('ink-soft', '#8a7a66')}'/>` +
      `<rect x='64' y='116' width='80' height='20' rx='10' fill='${hex('cta', hex('primary', '#7a4a1e'))}'/>` +
      `<circle cx='240' cy='120' r='18' fill='none' stroke='${hex('accent', '#b3261e')}' stroke-width='4'/>`,
  );
}

/** Contenu de départ : un univers intégré, à retoucher. */
export function contentFrom(base: SkinManifest): SkinContent {
  return { scheme: base.scheme, tokens: { ...base.tokens }, fonts: base.fonts ?? [], cover: drawnCover(base.tokens), sounds: base.sounds ?? {}, effects: base.effects ?? {} };
}

/**
 * Éditeur d'un skin de créateur (§ 19) : univers de départ, couleurs principales, police des
 * titres, couverture, sons et effets, et le manifeste complet pour aller plus loin. Aperçu en direct.
 */
@Component({
  selector: 'th-skin-editor',
  imports: [FormsModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, SkinDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = content();
    <div class="layout">
      <div class="fields">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Partir d'un univers</mat-label>
          <mat-select [value]="''" (selectionChange)="startFrom($event.value)">
            <mat-option value="" disabled>Choisir…</mat-option>
            @for (s of skins; track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
          <mat-hint>Recopie toutes ses valeurs : vous retouchez ensuite.</mat-hint>
        </mat-form-field>

        <mat-button-toggle-group [value]="c.scheme" (change)="patch({ scheme: $event.value })" hideSingleSelectionIndicator aria-label="Clair ou sombre">
          <mat-button-toggle value="light"><mat-icon>light_mode</mat-icon> Clair</mat-button-toggle>
          <mat-button-toggle value="dark"><mat-icon>dark_mode</mat-icon> Sombre</mat-button-toggle>
        </mat-button-toggle-group>

        <div class="colors">
          @for (col of colors; track col.token) {
            @let v = c.tokens[col.token] ?? '';
            <label class="color">
              <input type="color" [value]="isHex(v) ? v : '#000000'" (input)="setToken(col.token, $any($event.target).value)" [attr.aria-label]="col.label" />
              <span class="small">{{ col.label }}</span>
            </label>
          }
        </div>

        <div class="two">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Police des titres</mat-label>
            <mat-select [value]="c.tokens['font-title']" (selectionChange)="setToken('font-title', $event.value)">
              @for (f of fonts; track f) {
                <mat-option [value]="f"><span [style.font-family]="f">{{ fontName(f) }}</span></mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Police du texte</mat-label>
            <mat-select [value]="c.tokens['font-body']" (selectionChange)="setToken('font-body', $event.value)">
              @for (f of fonts; track f) {
                <mat-option [value]="f"><span [style.font-family]="f">{{ fontName(f) }}</span></mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="two">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Étape validée</mat-label>
            <mat-select [value]="c.effects?.validate ?? 'none'" (selectionChange)="patch({ effects: { ...c.effects, validate: $event.value } })">
              <mat-option value="stamp">Coup de tampon</mat-option>
              <mat-option value="pulse">Pulsation</mat-option>
              <mat-option value="none">Aucune animation</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Sons</mat-label>
            <mat-select [value]="''" (selectionChange)="soundsFrom($event.value)">
              <mat-option value="" disabled>Emprunter les sons de…</mat-option>
              @for (s of skins; track s.id) {
                <mat-option [value]="s.id">{{ s.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="cover-row">
          <img [src]="c.cover" alt="Couverture" />
          <div class="stack-s">
            <button mat-stroked-button type="button" (click)="file.click()"><mat-icon>image</mat-icon>Importer une image</button>
            <button mat-button type="button" (click)="patch({ cover: drawn() })"><mat-icon>brush</mat-icon>Dessiner d'après les couleurs</button>
            <input #file type="file" accept="image/*" hidden (change)="importCover($event)" />
          </div>
        </div>

        <details class="advanced" (toggle)="syncJson()">
          <summary>Manifeste complet (avancé)</summary>
          <p class="small muted">Tous les jetons, polices (woff2 en https), sons et effets : voir le guide des skins. Ce que le contrôle refuse est retiré à l'enregistrement.</p>
          <textarea class="json" [value]="json()" (input)="json.set($any($event.target).value)" rows="12" spellcheck="false"></textarea>
          <button mat-stroked-button type="button" (click)="applyJson()"><mat-icon>check</mat-icon>Appliquer</button>
        </details>
      </div>

      <div class="preview" [thSkin]="manifest()" aria-label="Aperçu du skin">
        <div class="banner preview-head">
          <span class="small muted">Aperçu joueur</span>
          <strong class="display">{{ name() || 'Votre univers' }}</strong>
        </div>
        <div class="surface taped">
          <span class="stamp">Énigme n° 2</span>
          <p class="note">« Là où l'eau chante sans jamais se taire, cherchez la première trace. »</p>
          <div class="row">
            <span class="stamp stamp--success">Étape trouvée</span>
            <span class="spacer"></span>
            <button type="button" class="try" (click)="tryFx($any($event.target))"><mat-icon inline>volume_up</mat-icon> Essayer</button>
          </div>
        </div>
        <button type="button" class="th-cta cta">Je suis arrivé</button>
      </div>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }
    .fields { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .colors { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
    .color { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .color input { width: 34px; height: 28px; padding: 0; border: 1px solid var(--th-border); border-radius: 6px; background: none; flex: none; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .cover-row { display: flex; gap: 12px; align-items: center; }
    .cover-row img { width: 160px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; border: 1px solid var(--th-border); }
    .stack-s { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
    .advanced summary { cursor: pointer; font-weight: 600; }
    .json { width: 100%; box-sizing: border-box; font: 0.8rem/1.4 ui-monospace, monospace; padding: 8px; border: 1px solid var(--th-border); border-radius: 8px; background: var(--th-surface-sunken); color: var(--th-ink); }
    .preview { position: sticky; top: 72px; min-height: 0; padding: 14px; border-radius: 14px; display: flex; flex-direction: column; gap: 12px; }
    .preview-head { display: flex; flex-direction: column; padding: 12px 14px; }
    .preview-head .display { font-size: 1.3rem; }
    .row { display: flex; align-items: center; gap: 8px; }
    .spacer { flex: 1; }
    .try { border: 0; background: none; color: var(--th-secondary); cursor: pointer; font: inherit; }
    .cta { align-self: center; padding: 10px 22px; border: 0; border-radius: 999px; font: inherit; font-weight: 700; }
  `,
})
export class SkinEditor {
  readonly content = model.required<SkinContent>();
  readonly name = input('');
  protected readonly fx = inject(SkinEffects);
  private readonly notify = inject(Notify);
  protected readonly skins = SKINS;
  protected readonly colors = COLORS;
  protected readonly fonts = FONTS;
  protected readonly json = signal('');

  /** Manifeste d'aperçu : identifiant provisoire, pour les sons et effets de l'essai. */
  protected readonly manifest = computed<SkinManifest>(() => ({ id: 'apercu', name: this.name(), description: '', author: '', price: 0, ...this.content() }));
  protected readonly drawn = computed(() => drawnCover(this.content().tokens));

  protected isHex(v: string): boolean {
    return /^#[0-9a-f]{6}$/i.test(v);
  }

  protected fontName(f: string): string {
    return f.split(',')[0].replace(/'/g, '');
  }

  protected patch(p: Partial<SkinContent>): void {
    this.content.update((c) => ({ ...c, ...p }));
  }

  protected setToken(token: SkinToken, value: string): void {
    this.content.update((c) => ({ ...c, tokens: { ...c.tokens, [token]: value } }));
  }

  protected startFrom(id: string): void {
    const cover = this.content().cover;
    const next = contentFrom(skinById(id));
    // Une image importée reste ; une couverture dessinée suit les nouvelles couleurs.
    this.content.set(cover.startsWith('data:image/jpeg') ? { ...next, cover } : next);
  }

  protected soundsFrom(id: string): void {
    const s = skinById(id);
    this.patch({ sounds: s.sounds ?? {}, effects: { ...this.content().effects, treasure: s.effects?.treasure ?? 'none', confetti: s.effects?.confetti } });
  }

  protected async importCover(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.patch({ cover: await compressPhoto(file, 640, 0.78) });
    } catch (e) {
      this.notify.error(e);
    }
  }

  /** Essai du son et de l'animation de validation de l'aperçu. */
  protected tryFx(target: Element): void {
    registerSkin(this.manifest());
    this.fx.validated(this.manifest().id, target);
  }

  protected syncJson(): void {
    this.json.set(JSON.stringify(this.content(), null, 2));
  }

  protected applyJson(): void {
    try {
      this.content.set(JSON.parse(this.json()) as SkinContent);
    } catch {
      this.notify.error(new Error('Manifeste illisible : vérifiez le JSON.'));
    }
  }
}
