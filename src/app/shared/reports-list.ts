import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { StepReport } from '@shared/models';
import { REPORT_CATEGORIES } from '@shared/reports';

/** Signalements des joueurs (§ 22), à traiter par l'organisateur ou l'auteur. */
@Component({
  selector: 'th-reports-list',
  imports: [DatePipe, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!reports().length) {
      <p class="muted small">Aucun problème signalé par les joueurs.</p>
    } @else {
      <p class="small muted">{{ open() }} à traiter{{ reports().length > open() ? ', ' + (reports().length - open()) + ' traité' + (reports().length - open() > 1 ? 's' : '') : '' }}.</p>
      <ul class="reports">
        @for (r of reports(); track r.id) {
          <li [class.resolved]="r.status === 'resolved'">
            <mat-icon class="icon">{{ category(r).icon }}</mat-icon>
            <div class="body">
              <strong>Étape {{ r.stepOrder }} — {{ r.stepTitle }}</strong>
              <span class="small">{{ category(r).label }}</span>
              @if (r.message) {
                <span class="small quote">« {{ r.message }} »</span>
              }
              <span class="small muted">{{ r.nickname ?? 'Un joueur' }}, {{ r.at | date: 'd MMM y, HH:mm' }}</span>
            </div>
            @if (r.status === 'open') {
              <button mat-stroked-button type="button" (click)="resolve.emit({ report: r, resolved: true })"><mat-icon>done</mat-icon>Traité</button>
            } @else {
              <button mat-button type="button" (click)="resolve.emit({ report: r, resolved: false })">Rouvrir</button>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .reports { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    li { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border-radius: 10px; background: var(--th-surface-sunken); }
    li.resolved { opacity: 0.6; }
    .icon { color: var(--th-danger); flex: none; }
    li.resolved .icon { color: var(--th-success); }
    .body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .quote { font-style: italic; }
  `,
})
export class ReportsList {
  readonly reports = input.required<StepReport[]>();
  readonly resolve = output<{ report: StepReport; resolved: boolean }>();
  protected readonly open = computed(() => this.reports().filter((r) => r.status === 'open').length);
  protected category(r: StepReport) {
    return REPORT_CATEGORIES.find((c) => c.id === r.category)!;
  }
}
