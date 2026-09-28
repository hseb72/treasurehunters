import { ChangeDetectionStrategy, Component, inject, Injectable, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ReportCategory } from '@shared/models';
import { REPORT_CATEGORIES } from '@shared/reports';
import { HuntApi } from '../core/api';
import { Notify } from '../core/notify';

interface ReportData {
  huntId: number;
  stepOrder: number;
  /** « l'étape 3 », « le lieu que vous cherchez ». */
  label: string;
}

/**
 * Signaler un problème sur une étape (§ 22) : lieu fermé, travaux, QR absent, énigme fausse…
 * Le signalement part à l'organisateur, ou à l'auteur quand la chasse vient du catalogue.
 */
@Component({
  selector: 'th-report-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Signaler un problème</h2>
    <mat-dialog-content>
      <p class="small muted">Sur {{ data.label }}. L'organisateur (ou l'auteur de la Secret Track) sera prévenu, et les prochains joueurs aussi.</p>
      <div class="categories" role="radiogroup" aria-label="Nature du problème">
        @for (c of categories; track c.id) {
          <button type="button" role="radio" class="category" [class.on]="category() === c.id" [attr.aria-checked]="category() === c.id" (click)="category.set(c.id)">
            <mat-icon>{{ c.icon }}</mat-icon>{{ c.label }}
          </button>
        }
      </div>
      <textarea class="message" rows="3" maxlength="500" [ngModel]="message()" (ngModelChange)="message.set($event)" placeholder="Un détail utile (facultatif) : ce que vous avez vu, par où contourner…" aria-label="Détail"></textarea>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Annuler</button>
      <button mat-flat-button type="button" (click)="send()" [disabled]="!category() || busy()">Envoyer</button>
    </mat-dialog-actions>
  `,
  styles: `
    .categories { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0; }
    @media (max-width: 480px) { .categories { grid-template-columns: 1fr; } }
    .category {
      display: flex; align-items: center; gap: 6px; padding: 8px 10px; text-align: left; cursor: pointer;
      border: 1px solid var(--th-border); border-radius: 10px; background: var(--th-surface-raised); color: var(--th-ink); font: inherit; font-size: 0.9rem;
    }
    .category mat-icon { color: var(--th-primary); flex: none; }
    .category.on { border-color: var(--th-primary-light); box-shadow: 0 0 0 2px color-mix(in srgb, var(--th-primary-light) 30%, transparent); font-weight: 600; }
    .message { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid var(--th-border); border-radius: 10px; font: inherit; color: var(--th-ink); background: var(--th-surface-raised); }
  `,
})
export class ReportDialog {
  protected readonly data = inject<ReportData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ReportDialog, boolean>);
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  protected readonly categories = REPORT_CATEGORIES;
  protected readonly category = signal<ReportCategory | null>(null);
  protected readonly message = signal('');
  protected readonly busy = signal(false);

  protected send(): void {
    this.busy.set(true);
    this.api.reportStep(this.data.huntId, { stepOrder: this.data.stepOrder, category: this.category()!, message: this.message().trim() || null }).subscribe({
      next: () => {
        this.notify.info('Merci ! Le problème est signalé.');
        this.ref.close(true);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
}

@Injectable({ providedIn: 'root' })
export class ReportProblem {
  private readonly dialog = inject(MatDialog);

  open(huntId: number, stepOrder: number, label: string): void {
    this.dialog.open(ReportDialog, { data: { huntId, stepOrder, label } satisfies ReportData, maxWidth: '520px', width: '100%' });
  }
}
