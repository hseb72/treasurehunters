import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { of, switchMap, timer } from 'rxjs';
import { HuntApi } from '../../core/api';
import { Clock } from '../../core/clock';
import { LiveRow } from '../../core/models';
import { Notify } from '../../core/notify';
import { formatClock } from '../../shared/format';
import { WorkspaceState } from './workspace-state';

const REFRESH_MS = 10_000;

@Component({
  selector: 'th-live-board',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatMenuModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './live-board.html',
  styleUrl: './live-board.scss',
})
export class LiveBoardPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly clock = inject(Clock);
  protected readonly workspace = inject(WorkspaceState);

  protected readonly hunt = computed(() => this.workspace.hunt.value());
  private readonly steps = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.getSteps(params),
    defaultValue: [],
  });
  protected readonly rows = rxResource({
    params: () => ({ id: this.workspace.huntId(), status: this.hunt()?.status }),
    stream: ({ params }) =>
      params.status === 'running' || params.status === 'closed'
        ? timer(0, REFRESH_MS).pipe(switchMap(() => this.api.getLive(params.id)))
        : of([]),
    defaultValue: [],
  });

  protected readonly total = computed(() => Math.max(this.steps.value().length - 1, 1));
  protected readonly segments = computed(() => Array.from({ length: this.total() }, (_, i) => i + 1));
  protected readonly stats = computed(() => {
    const rows = this.rows.value();
    return {
      waiting: rows.filter((r) => r.status === 'waiting').length,
      running: rows.filter((r) => r.status === 'running').length,
      finished: rows.filter((r) => r.status === 'finished').length,
    };
  });
  protected readonly elapsed = computed(() => {
    const h = this.hunt();
    if (!h?.started) return '';
    const end = h.closed ? Date.parse(h.closed) : this.clock.now();
    return formatClock(end - Date.parse(h.started));
  });

  protected since(iso: string | null): string {
    if (!iso) return '';
    const min = Math.floor((this.clock.now() - Date.parse(iso)) / 60_000);
    return min < 1 ? "à l'instant" : `il y a ${min} min`;
  }

  protected startsIn(iso: string | null): string {
    return iso ? formatClock(Date.parse(iso) - this.clock.now()) : '';
  }

  protected nextStepTitle(row: LiveRow): string {
    return this.steps.value().find((s) => s.order === row.lastOrder + 1)?.title ?? '';
  }

  protected validateNext(row: LiveRow): void {
    const step = this.steps.value().find((s) => s.order === row.lastOrder + 1);
    if (!step) return;
    this.api.validateManually(row.team.id, step.id).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.notify.info(`Étape ${step.order} validée pour ${row.team.name}.`);
      },
      error: (e) => this.notify.error(e),
    });
  }

  protected delay(row: LiveRow, minutes: number): void {
    this.api.delayTeam(row.team.id, minutes).subscribe({
      next: () => {
        this.rows.reload();
        this.notify.info(`Départ de ${row.team.name} décalé de ${minutes} min.`);
      },
      error: (e) => this.notify.error(e),
    });
  }
}
