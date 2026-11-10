import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { HuntTransfer } from '../organize/hunt-transfer';
import { of } from 'rxjs';
import { HuntApi } from '../../core/api';
import { Session } from '../../core/session';
import { DurationPipe } from '../../shared/format';
import { penaltyText, START_MODE_LABELS } from '../../shared/labels';
import { Podium } from '../../shared/podium';
import { RatingForm } from '../../shared/rating-form';

import { SkinDirective } from '../../shared/skin';

@Component({
  selector: 'th-results',
  imports: [HuntTransfer, SkinDirective, DatePipe, MatButtonModule, MatIconModule, RouterLink, DurationPipe, Podium, RatingForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class ResultsPage {
  private readonly api = inject(HuntApi);
  private readonly session = inject(Session);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly hunt = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.getHunt(params) });
  /** Skin de la chasse, dès qu'elle est connue. */
  protected readonly skin = computed(() => this.hunt.value()?.skin);
  protected readonly rows = rxResource({
    params: () => ({ id: this.id(), user: this.session.user()?.id }),
    stream: ({ params }) => this.api.getResults(params.id),
  });
  private readonly myTeam = rxResource({
    params: () => ({ id: this.id(), user: this.session.user()?.id }),
    stream: ({ params }) => (params.user ? this.api.myTeam(params.id) : of(null)),
  });

  protected readonly myTeamId = computed(() => this.myTeam.value()?.id ?? null);
  /** Équipe du joueur arrivée : son souvenir est prêt (§ 24). */
  protected readonly souvenirReady = computed(() => !!this.myTeam.value()?.finished);
  /** Chasse surprise finie (§ 52) : son joueur peut l'exporter, la faire réécrire et en garder sa version. */
  protected readonly rewritable = computed(() => {
    const h = this.hunt.value();
    return !!h?.surprise && h.hostId === this.session.user()?.id && this.souvenirReady();
  });
  private readonly router = inject(Router);
  protected openCopy(huntId: number): void {
    void this.router.navigate(['/organize', huntId, 'steps']);
  }
  protected readonly ranked = computed(() => (this.rows.value() ?? []).filter((r) => r.rank !== null));
  protected readonly unranked = computed(() => (this.rows.value() ?? []).filter((r) => r.rank === null));
  protected readonly modes = START_MODE_LABELS;
  protected readonly penalties = computed(() => penaltyText(this.hunt.value()?.hintPenalties ?? []));
}
