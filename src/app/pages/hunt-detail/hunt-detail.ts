import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, numberAttribute, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { Observable, of } from 'rxjs';
import { HuntApi } from '../../core/api';
import { Clock } from '../../core/clock';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';
import { formatClock } from '../../shared/format';
import { penaltyText, START_MODE_LABELS } from '../../shared/labels';
import { InvitePanel } from '../../shared/invite-panel';
import { StatusBadge } from '../../shared/status-badge';

@Component({
  selector: 'th-hunt-detail',
  imports: [CurrencyPipe, DatePipe, FormsModule, InvitePanel, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, RouterLink, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hunt-detail.html',
  styleUrl: './hunt-detail.scss',
})
export class HuntDetailPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  protected readonly session = inject(Session);
  protected readonly clock = inject(Clock);

  readonly id = input.required({ transform: numberAttribute });
  /** Code d'invitation reçu (chasse ou équipe), pour préremplir le formulaire. */
  readonly code = input<string>();

  protected readonly hunt = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.getHunt(params) });
  protected readonly teams = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.getTeams(params), defaultValue: [] });
  protected readonly myTeam = rxResource({
    params: () => ({ id: this.id(), user: this.session.user()?.id }),
    stream: ({ params }) => (params.user ? this.api.myTeam(params.id) : of(null)),
  });

  protected readonly teamName = signal('');
  protected readonly teamCode = linkedSignal(() => {
    const code = this.code();
    const hunt = this.hunt.value();
    // Un code de chasse n'est pas un code d'équipe : on ne préremplit que ce dernier.
    return code && hunt && code !== hunt.joinCode ? code : '';
  });
  protected readonly busy = signal(false);
  protected readonly modes = START_MODE_LABELS;

  protected readonly penalties = computed(() => penaltyText(this.hunt.value()?.hintPenalties ?? []));
  protected readonly isOwner = computed(() => this.hunt.value()?.ownerId === this.session.user()?.id);
  protected readonly isHost = computed(() => {
    const h = this.hunt.value();
    return !!h?.surprise && h.hostId === this.session.user()?.id;
  });
  /** Inscriptions ouvertes : avant le départ, ou pendant une chasse surprise « chacun son chrono ». */
  protected readonly joinOpen = computed(() => {
    const h = this.hunt.value();
    return !!h && (h.status === 'published' || (h.surprise && h.selfPaced && h.status === 'running'));
  });

  protected countdown(iso: string): string {
    return formatClock(Date.parse(iso) - this.clock.now());
  }

  protected createTeam(): void {
    if (this.teamName().trim()) this.act(this.api.createTeam(this.id(), this.teamName()), 'Équipe créée : partagez son code !');
  }

  protected joinTeam(): void {
    if (this.teamCode().trim()) this.act(this.api.joinTeam(this.teamCode()), 'Bienvenue dans l’équipe !');
  }

  protected joinSolo(): void {
    this.act(this.api.joinSolo(this.id()), 'Inscription confirmée.');
  }

  protected leave(): void {
    this.act(this.api.leaveHunt(this.id()), 'Vous avez quitté la chasse.');
  }

  protected login(): void {
    this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }

  private act(call: Observable<unknown>, success: string): void {
    this.busy.set(true);
    call.subscribe({
      next: () => {
        this.notify.info(success);
        this.myTeam.reload();
        this.teams.reload();
        this.hunt.reload();
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }
}
