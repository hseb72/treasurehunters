import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { filter, of, switchMap, timer } from 'rxjs';
import { Hunt, PhotoAttempt } from '@shared/models';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';
import { AuthImage } from '../../shared/auth-image';
import { Confirm } from '../../shared/confirm-dialog';

const REFRESH_MS = 20_000;

/**
 * Contrôle des photos (§ 12) : chaque photo qui a validé une étape (reconnue par l'IA, ou
 * confirmée par l'équipe) est tamponnée ou refusée par l'organisateur, pendant la course
 * ou après la clôture. Refusée, elle compte comme un abandon de l'épreuve.
 */
@Component({
  selector: 'th-photo-review',
  imports: [AuthImage, DatePipe, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './photo-review.html',
  styleUrl: './photo-review.scss',
})
export class PhotoReviewPanel {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);

  readonly hunt = input.required<Hunt>();
  /** Ordre de l'arrivée : une photo d'arrivée refusée retire l'équipe du classement. */
  readonly finalOrder = input.required<number>();
  /** Un contrôle change la progression des équipes : le tableau se recharge. */
  readonly reviewed = output<void>();

  protected readonly photos = rxResource({
    params: () => ({ id: this.hunt().id, status: this.hunt().status }),
    stream: ({ params }) =>
      params.status === 'running' || params.status === 'closed'
        ? timer(0, REFRESH_MS).pipe(switchMap(() => this.api.huntPhotos(params.id)))
        : of([]),
    defaultValue: [],
  });

  /** Photos qui ont validé une étape : à contrôler d'abord, puis les plus récentes. */
  protected readonly counted = computed(() =>
    this.photos
      .value()
      .filter((p) => p.review)
      .sort((a, b) => Number(b.review === 'pending') - Number(a.review === 'pending') || b.id - a.id),
  );
  protected readonly pending = computed(() => this.counted().filter((p) => p.review === 'pending').length);

  protected approve(p: PhotoAttempt): void {
    this.send(p, true, `Photo de ${p.teamName} tamponnée.`);
  }

  protected reject(p: PhotoAttempt): void {
    const isFinal = p.stepOrder === this.finalOrder();
    const penalty = this.hunt().skipPenalty;
    this.confirm
      .ask({
        title: `Refuser la photo de ${p.teamName} ?`,
        message: isFinal
          ? 'L’arrivée ne s’abandonne pas : l’équipe ne sera plus arrivée, et non classée tant qu’elle n’a pas trouvé le trésor.'
          : `L’épreuve ${p.stepOrder} comptera comme abandonnée${penalty ? ` (+${penalty} min de pénalité)` : ''}. Ce choix est définitif.`,
        confirm: 'Refuser',
        danger: true,
      })
      .pipe(filter(Boolean))
      .subscribe(() => this.send(p, false, `Photo de ${p.teamName} refusée.`));
  }

  private send(p: PhotoAttempt, approve: boolean, done: string): void {
    this.api.reviewPhoto(p.id, approve).subscribe({
      next: (list) => {
        this.photos.set(list);
        this.reviewed.emit();
        this.notify.info(done);
      },
      error: (e) => this.notify.error(e),
    });
  }
}
