import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { CatalogEntry } from '@shared/models';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';
import { ReportsList } from '../../shared/reports-list';
import { StepStatsTable } from '../../shared/step-stats-table';

/**
 * Suivi d'une version partagée au catalogue (§ 22) : les problèmes signalés par les joueurs de
 * toutes ses parties (copies, parties en autonomie) et ce qui se passe à chaque étape.
 */
@Component({
  selector: 'th-entry-follow-up',
  imports: [MatIconModule, ReportsList, StepStatsTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="surface stack follow">
      <h2 class="section-title"><mat-icon>monitoring</mat-icon> Suivi de « {{ entry().title }} »</h2>
      <p class="small muted">Toutes ses parties : la vôtre, les copies des autres organisateurs et les parties en autonomie.</p>
      <h3><mat-icon inline>flag</mat-icon> Problèmes signalés</h3>
      @if (reports.value(); as list) {
        <th-reports-list [reports]="list" (resolve)="resolve($event.report.id, $event.resolved)" />
      }
      <h3><mat-icon inline>insights</mat-icon> Étape par étape</h3>
      @if (stats.value(); as st) {
        <th-step-stats [stats]="st" />
      }
    </section>
  `,
  styles: `
    .follow h2 { display: flex; align-items: center; gap: 6px; margin: 0; }
    h3 { margin: 8px 0 0; font-size: 1rem; }
  `,
})
export class EntryFollowUp {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  readonly entry = input.required<CatalogEntry>();
  protected readonly reports = rxResource({ params: () => this.entry().id, stream: ({ params }) => this.api.catalogReports(params) });
  protected readonly stats = rxResource({ params: () => this.entry().id, stream: ({ params }) => this.api.catalogStats(params) });

  protected resolve(id: number, resolved: boolean): void {
    this.api.resolveReport(id, resolved).subscribe({ next: () => this.reports.reload(), error: (e) => this.notify.error(e) });
  }
}
