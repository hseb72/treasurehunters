import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { filter, switchMap, timer } from 'rxjs';
import { CheckinResult } from '@shared/models';
import { HuntApi } from '../../core/api';
import { currentPosition } from '../../core/geo';
import { Clock } from '../../core/clock';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';
import { formatDuration } from '@shared/rules';
import { formatClock } from '../../shared/format';
import { Confirm } from '../../shared/confirm-dialog';
import { InvitePanel } from '../../shared/invite-panel';
import { Trail } from '../../shared/trail';

/** Rafraîchissement pour voir les scans des équipiers. */
const REFRESH_MS = 15_000;

@Component({
  selector: 'th-play',
  imports: [DatePipe, InvitePanel, MatButtonModule, MatIconModule, RouterLink, Trail],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './play.html',
  styleUrl: './play.scss',
})
export class PlayPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly clock = inject(Clock);
  private readonly confirm = inject(Confirm);
  private readonly session = inject(Session);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly state = rxResource({
    params: () => this.id(),
    stream: ({ params }) => timer(0, REFRESH_MS).pipe(switchMap(() => this.api.getPlay(params))),
  });

  /** Premier appui sur un joker = demande de confirmation. */
  protected readonly confirmHint = signal(false);
  protected readonly busy = signal(false);
  /** Recherche de la position en cours (« Je suis arrivé »). */
  protected readonly locating = signal(false);
  /** Dernier « Je suis arrivé » : lieu trouvé, ou distance restante. */
  protected readonly checkin = signal<CheckinResult | null>(null);

  /** Phase de jeu de l'équipe. */
  protected readonly phase = computed(() => {
    const s = this.state.value();
    if (!s) return 'loading';
    if (s.team.finished) return 'finished';
    // Chasse surprise « chacun son chrono » : la course a pu partir sans notre équipe.
    if (s.hunt.status === 'published' || s.selfStart) return 'before';
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

  /** Chasse surprise : le joueur l'a créée, il choisit le mode de départ tant que rien n'est parti. */
  protected readonly isHost = computed(() => {
    const s = this.state.value();
    return !!s?.hunt.surprise && s.hunt.hostId === this.session.user()?.id;
  });

  /** Chasse surprise encore ouverte aux inscriptions : on peut inviter pendant la course. */
  protected readonly invitesOpen = computed(() => {
    const h = this.state.value()?.hunt;
    return !!h?.surprise && (h.status === 'published' || (h.selfPaced && h.status === 'running'));
  });

  protected setSelfPaced(selfPaced: boolean): void {
    this.busy.set(true);
    this.api.setSelfPaced(this.id(), selfPaced).subscribe({
      next: () => {
        this.state.reload();
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

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
          this.checkin.set(null);
          this.busy.set(false);
          this.notify.info('Épreuve abandonnée : place à l’énigme suivante.');
        },
        error: (e) => {
          this.notify.error(e);
          this.busy.set(false);
        },
      });
  }

  /** Chasse surprise : le joueur donne le départ (de son équipe, ou de tous en départ commun). */
  protected go(): void {
    this.busy.set(true);
    this.api.selfStart(this.id()).subscribe({
      next: (s) => {
        this.state.set(s);
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

  /** « Je suis arrivé » : la position du téléphone valide l'étape cherchée si elle est assez proche. */
  protected async arrived(): Promise<void> {
    this.locating.set(true);
    this.checkin.set(null);
    try {
      const pos = await currentPosition();
      this.api.checkin(this.id(), pos).subscribe({
        next: (r) => {
          this.checkin.set(r);
          this.state.set(r.state);
          this.confirmHint.set(false);
          this.locating.set(false);
        },
        error: (e) => {
          this.notify.error(e);
          this.locating.set(false);
        },
      });
    } catch (e) {
      this.notify.error(e);
      this.locating.set(false);
    }
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
