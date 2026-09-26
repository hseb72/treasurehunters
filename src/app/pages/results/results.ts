import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { HuntApi } from '../../core/api';
import { Session } from '../../core/session';
import { DurationPipe } from '../../shared/format';
import { penaltyText, START_MODE_LABELS } from '../../shared/labels';
import { Podium } from '../../shared/podium';
import { RatingForm } from '../../shared/rating-form';

@Component({
  selector: 'th-results',
  imports: [DatePipe, MatButtonModule, MatIconModule, RouterLink, DurationPipe, Podium, RatingForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class ResultsPage {
  private readonly api = inject(HuntApi);
  private readonly session = inject(Session);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly hunt = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.getHunt(params) });
  protected readonly rows = rxResource({
    params: () => ({ id: this.id(), user: this.session.user()?.id }),
    stream: ({ params }) => this.api.getResults(params.id),
  });
  private readonly myTeam = rxResource({
    params: () => ({ id: this.id(), user: this.session.user()?.id }),
    stream: ({ params }) => (params.user ? this.api.myTeam(params.id) : of(null)),
  });

  protected readonly myTeamId = computed(() => this.myTeam.value()?.id ?? null);
  protected readonly ranked = computed(() => (this.rows.value() ?? []).filter((r) => r.rank !== null));
  protected readonly unranked = computed(() => (this.rows.value() ?? []).filter((r) => r.rank === null));
  protected readonly modes = START_MODE_LABELS;
  protected readonly penalties = computed(() => penaltyText(this.hunt.value()?.hintPenalties ?? []));
}
