import { ChangeDetectionStrategy, Component, inject, Injectable, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { HuntApi } from '../core/api';
import { DomTranslator } from '../core/dom-translator';
import { Notify } from '../core/notify';
import { Session } from '../core/session';
import { ShareLink } from '../core/share';

interface DareData {
  catalogId: number;
  huntId: number;
  title: string;
}

/** Temps lisible dans un message : « 1 h 12 », « 48 min ». */
function clock(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

/**
 * Défier un ami (§ 28, § 39) : un mot facultatif, puis le lien « bats mon temps » à partager.
 * « Sébastien a terminé « Le mystère du château » en 1 h 12. Tu penses pouvoir faire mieux ? »
 */
@Component({
  selector: 'th-dare-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title><mat-icon inline>sports_score</mat-icon> Défier un ami</h2>
    <mat-dialog-content>
      <p class="small muted">Vos amis recevront un lien vers la Secret Track, avec votre temps à battre. Vous verrez sur sa fiche qui relève le défi, et qui vous bat.</p>
      <textarea rows="3" maxlength="200" [ngModel]="message()" (ngModelChange)="message.set($event)" placeholder="Un mot pour eux (facultatif) : « Même avec deux jokers, vous n’y arriverez pas ! »" aria-label="Votre mot"></textarea>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Annuler</button>
      <button mat-flat-button type="button" (click)="send()" [disabled]="busy()"><mat-icon>share</mat-icon>Envoyer le défi</button>
    </mat-dialog-actions>
  `,
  styles: `
    textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid var(--th-border); border-radius: 10px; font: inherit; color: var(--th-ink); background: var(--th-surface-raised); }
  `,
})
export class DareDialog {
  private readonly data = inject<DareData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<DareDialog>);
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly session = inject(Session);
  private readonly shareLink = inject(ShareLink);
  private readonly i18n = inject(DomTranslator);
  protected readonly message = signal('');
  protected readonly busy = signal(false);

  protected send(): void {
    this.busy.set(true);
    const { catalogId, huntId, title } = this.data;
    this.api.setChallenge(catalogId, huntId, this.message().trim() || null).subscribe({
      next: (c) => {
        this.ref.close();
        const who = this.session.user()?.nickname ?? c.teamName;
        const text = `${who} a terminé « ${title} » en ${clock(c.time)}. Tu penses pouvoir faire mieux ?`;
        const url = `${location.origin}/catalog/${catalogId}?defi=${huntId}`;
        void this.shareLink.share(title, [this.i18n.t(text), c.message].filter(Boolean).join(' '), url);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
}

@Injectable({ providedIn: 'root' })
export class Dare {
  private readonly dialog = inject(MatDialog);

  open(catalogId: number, huntId: number, title: string): void {
    this.dialog.open(DareDialog, { data: { catalogId, huntId, title } satisfies DareData, maxWidth: '480px', width: '100%' });
  }
}
