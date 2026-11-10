import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HuntImportResult } from '@shared/seed';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';

/**
 * Export / import JSON d'une chasse (§ 52) : on l'exporte pour la faire réécrire (par une IA, à
 * la main), puis on la réimporte. Aperçu avant d'appliquer : réécrite sur place si elle n'a pas été
 * jouée, sinon une nouvelle version en brouillon (l'ancienne et ses avis restent intacts).
 */
@Component({
  selector: 'th-hunt-transfer',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="actions">
      <button mat-stroked-button type="button" (click)="download()" [disabled]="busy()"><mat-icon>download</mat-icon>Exporter (JSON)</button>
      <button mat-stroked-button type="button" (click)="picker.click()" [disabled]="busy()"><mat-icon>upload</mat-icon>Importer (JSON)</button>
      <input #picker type="file" accept="application/json,.json" hidden (change)="pick(picker)" />
    </div>
    <p class="small muted">Exportez la Secret Track pour la faire réécrire, puis réimportez le fichier : fiche, lieux, énigmes, jokers et messages sont repris.</p>

    @if (preview(); as p) {
      <div class="preview surface" role="status">
        @if (p.mode === 'replace') {
          <p><strong>Le parcours sera réécrit</strong> avec les {{ p.steps }} lieux du fichier. Les étapes sont reprises dans l'ordre, celles de trop sont retirées.</p>
        } @else {
          <p><strong>Une nouvelle version sera créée en brouillon</strong> avec les {{ p.steps }} lieux du fichier.</p>
        }
        @if (p.warnings.length) {
          <ul class="small">
            @for (w of p.warnings; track $index) {
              <li>{{ w }}</li>
            }
          </ul>
        }
        <div class="actions">
          <button mat-flat-button type="button" (click)="apply()" [disabled]="busy()"><mat-icon>check</mat-icon>{{ p.mode === 'replace' ? 'Réécrire' : 'Créer la nouvelle version' }}</button>
          <button mat-button type="button" (click)="preview.set(null)" [disabled]="busy()">Annuler</button>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; margin-bottom: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .preview { margin-top: 8px; padding: 12px; }
    .preview p { margin: 0 0 8px; }
    ul { margin: 0 0 8px; padding-left: 18px; }
  `,
})
export class HuntTransfer {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  readonly huntId = input.required<number>();
  /** Import appliqué : la chasse réécrite (même id) ou la nouvelle version. */
  readonly imported = output<HuntImportResult>();
  protected readonly busy = signal(false);
  protected readonly preview = signal<HuntImportResult | null>(null);
  private file: unknown = null;

  protected download(): void {
    this.busy.set(true);
    this.api.exportHunt(this.huntId()).subscribe({
      next: (file) => {
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${slug(file.name) || 'secret-track'}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

  protected async pick(input: HTMLInputElement): Promise<void> {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      this.file = JSON.parse(await f.text());
    } catch {
      this.notify.info('Ce fichier n’est pas du JSON lisible.');
      return;
    }
    this.busy.set(true);
    this.api.importHunt(this.huntId(), this.file, true).subscribe({
      next: (r) => {
        this.preview.set(r);
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

  protected apply(): void {
    this.busy.set(true);
    this.api.importHunt(this.huntId(), this.file, false).subscribe({
      next: (r) => {
        this.preview.set(null);
        this.busy.set(false);
        this.notify.info(r.mode === 'replace' ? 'Parcours réécrit.' : 'Nouvelle version créée en brouillon.');
        this.imported.emit(r);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
