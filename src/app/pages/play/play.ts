import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { filter, switchMap, timer } from 'rxjs';
import { HuntApi } from '../../core/api';
import { Clock } from '../../core/clock';
import { Notify } from '../../core/notify';
import { formatDuration } from '@shared/rules';
import { formatClock } from '../../shared/format';
import { Confirm } from '../../shared/confirm-dialog';
import { Trail } from '../../shared/trail';

/** Rafraîchissement pour voir les scans des équipiers. */
const REFRESH_MS = 15_000;

@Component({
  selector: 'th-play',
  imports: [DatePipe, MatButtonModule, MatIconModule, RouterLink, Trail],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './play.html',
  styleUrl: './play.scss',
})
export class PlayPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly clock = inject(Clock);
  private readonly confirm = inject(Confirm);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly state = rxResource({
    params: () => this.id(),
    stream: ({ params }) => timer(0, REFRESH_MS).pipe(switchMap(() => this.api.getPlay(params))),
  });

  /** Premier appui sur un joker = demande de confirmation. */
  protected readonly confirmHint = signal(false);
  protected readonly busy = signal(false);

  /** Phase de jeu de l'équipe. */
  protected readonly phase = computed(() => {
    const s = this.state.value();
    if (!s) return 'loading';
    if (s.team.finished) return 'finished';
    if (s.hunt.status === 'published') return 'before';
    if (s.hunt.status !== 'running') return 'over';
    if (!s.team.started || Date.parse(s.team.started) > this.clock.now()) return 'waiting';
    return 'playing';
  });

  protected readonly skippedOrders = computed(() => (this.state.value()?.validated ?? []).filter((v) => v.skipped).map((v) => v.order));

  protected readonly chrono = computed(() => {
    const s = this.state.value();
    if (!s?.team.started) return '';
    const end = s.team.finished ? Date.parse(s.team.finished) : this.clock.now();
    return formatClock(end - Date.parse(s.team.started));
  });

  protected readonly finalTime = computed(() => {
    const s = this.state.value();
    if (!s?.team.finished || !s.team.started) return '';
    const seconds = (Date.parse(s.team.finished) - Date.parse(s.team.started)) / 1000;
    return formatDuration(seconds + s.penalty * 60);
  });

  /** Pénalité du prochain joker de l'énigme en cours, en minutes. */
  protected readonly nextHintPenalty = computed(() => {
    const s = this.state.value();
    return s?.clue ? (s.hunt.hintPenalties[s.clue.hintsRevealed.length] ?? 0) : 0;
  });

  protected countdown(iso: string | null): string {
    return iso ? formatClock(Date.parse(iso) - this.clock.now()) : '';
  }

  /** Abandon de l'épreuve en cours (« 4ᵉ joker »), après confirmation. */
  protected skip(targetOrder: number): void {
    const penalty = this.state.value()?.hunt.skipPenalty ?? 0;
    this.confirm
      .ask({
        title: `Abandonner l’épreuve ${targetOrder} ?`,
        message:
          (penalty ? `Votre équipe prendra ${penalty} min de pénalité. ` : '') +
          'L’énigme suivante s’affichera aussitôt, sans que vous ayez trouvé ce lieu. Ce choix est définitif.',
        confirm: 'Abandonner',
        danger: true,
      })
      .pipe(
        filter(Boolean),
        switchMap(() => {
          this.busy.set(true);
          return this.api.skipStep(this.id());
        }),
      )
      .subscribe({
        next: (s) => {
          this.state.set(s);
          this.confirmHint.set(false);
          this.busy.set(false);
          this.notify.info('Épreuve abandonnée : place à l’énigme suivante.');
        },
        error: (e) => {
          this.notify.error(e);
          this.busy.set(false);
        },
      });
  }

  protected revealHint(): void {
    if (!this.confirmHint()) {
      this.confirmHint.set(true);
      return;
    }
    this.busy.set(true);
    this.api.revealHint(this.id()).subscribe({
      next: (s) => {
        this.state.set(s);
        this.confirmHint.set(false);
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }
}
