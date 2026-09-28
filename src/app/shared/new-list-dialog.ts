import { ChangeDetectionStrategy, Component, inject, Injectable, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { LIST_ICONS, TrackList } from '@shared/lists';
import { Observable } from 'rxjs';
import { ListsStore } from '../core/lists-store';
import { Notify } from '../core/notify';

/** Nouvelle liste (§ 38) : un nom, une icône. */
@Component({
  selector: 'th-new-list-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Nouvelle liste</h2>
    <form (ngSubmit)="create()">
      <mat-dialog-content>
        <mat-form-field class="full">
          <mat-label>Nom</mat-label>
          <input matInput name="name" maxlength="60" [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="Week-end à Toulouse, Avec les enfants…" cdkFocusInitial />
        </mat-form-field>
        <div class="icons" role="radiogroup" aria-label="Icône">
          @for (i of icons; track i) {
            <button type="button" role="radio" class="icon" [class.on]="icon() === i" [attr.aria-checked]="icon() === i" (click)="icon.set(i)"><mat-icon>{{ i }}</mat-icon></button>
          }
        </div>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Annuler</button>
        <button mat-flat-button type="submit" [disabled]="!name().trim() || busy()">Créer</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .full { width: 100%; }
    .icons { display: flex; flex-wrap: wrap; gap: 6px; }
    .icon { width: 40px; height: 40px; display: grid; place-items: center; border: 1px solid var(--th-border); border-radius: 10px; background: var(--th-surface-raised); color: var(--th-primary); cursor: pointer; }
    .icon.on { border-color: var(--th-primary-light); box-shadow: 0 0 0 2px color-mix(in srgb, var(--th-primary-light) 30%, transparent); }
  `,
})
export class NewListDialog {
  private readonly ref = inject(MatDialogRef<NewListDialog, TrackList>);
  private readonly store = inject(ListsStore);
  private readonly notify = inject(Notify);
  protected readonly icons = LIST_ICONS;
  protected readonly name = signal('');
  protected readonly icon = signal(LIST_ICONS[0]!);
  protected readonly busy = signal(false);

  protected create(): void {
    if (!this.name().trim()) return;
    this.busy.set(true);
    this.store.create(this.name().trim(), this.icon()).subscribe({
      next: (l) => this.ref.close(l),
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
}

@Injectable({ providedIn: 'root' })
export class NewList {
  private readonly dialog = inject(MatDialog);

  open(): Observable<TrackList | undefined> {
    return this.dialog.open<NewListDialog, void, TrackList>(NewListDialog, { maxWidth: '440px', width: '100%' }).afterClosed();
  }
}
