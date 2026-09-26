import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { filter, switchMap } from 'rxjs';
import { DIFFICULTY_LABELS } from '@shared/generation';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';
import { Confirm } from '../../shared/confirm-dialog';
import { Stars } from '../../shared/stars';

/** Fiche d'une version du catalogue : présentation, extrait, avis, versions, et copie. */
@Component({
  selector: 'th-catalog-entry',
  imports: [DatePipe, MatButtonModule, MatIconModule, RouterLink, Stars],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-entry.html',
  styleUrl: './catalog-entry.scss',
})
export class CatalogEntryPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  private readonly confirm = inject(Confirm);
  protected readonly session = inject(Session);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly entry = rxResource({
    params: () => ({ id: this.id(), user: this.session.user()?.id }),
    stream: ({ params }) => this.api.getCatalogEntry(params.id),
  });
  protected readonly busy = signal(false);
  protected readonly difficulty = DIFFICULTY_LABELS;
  protected readonly isAuthor = computed(() => this.entry.value()?.authorId === this.session.user()?.id);
  protected readonly criteria = computed(() => {
    const r = this.entry.value()?.rating;
    return r
      ? [
          { label: 'Énigmes', value: r.riddles },
          { label: 'Parcours', value: r.route },
          { label: 'Ambiance', value: r.mood },
        ]
      : [];
  });

  /** Brouillon à partir de cette version : l'organisateur l'adapte ensuite librement. */
  protected copy(): void {
    if (!this.session.loggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.busy.set(true);
    this.api.copyFromCatalog(this.id()).subscribe({
      next: (hunt) => {
        this.notify.info('Votre chasse est créée en brouillon : adaptez-la, fixez les dates et imprimez vos QR codes.');
        this.router.navigate(['/organize', hunt.id, 'info']);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

  protected withdraw(): void {
    this.confirm
      .ask({
        title: 'Retirer cette version du catalogue ?',
        message: 'Elle n’apparaîtra plus dans le catalogue. Les chasses déjà copiées à partir d’elle ne changent pas.',
        confirm: 'Retirer',
        danger: true,
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.withdrawFromCatalog(this.id())),
      )
      .subscribe({
        next: (e) => {
          this.entry.set(e);
          this.notify.info('Version retirée du catalogue.');
        },
        error: (e) => this.notify.error(e),
      });
  }
}
