import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AssistSuggestion } from '@shared/assist';
import { diagnoseSteps, StepDiagnosis } from '@shared/diagnosis';
import { HuntStats, Step, StepReport } from '@shared/models';
import { switchMap } from 'rxjs';
import { HuntApi } from '../core/api';
import { Notify } from '../core/notify';

/**
 * Étapes problématiques (§ 43) : ce que disent les statistiques, les signalements et la
 * fiabilité GPS, étape par étape. « Analyser avec l'IA » explique pourquoi les joueurs bloquent
 * et propose une énigme corrigée, que l'auteur garde (dans sa Secret Track) ou non.
 */
@Component({
  selector: 'th-step-diagnosis',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (d of diagnosis(); track d.order) {
      <section class="diag" [class.alert]="d.severity === 'alert'" role="note">
        <p class="head"><mat-icon inline>warning</mat-icon> <strong>Étape {{ d.order }} ({{ d.title }}) : elle semble poser problème.</strong></p>
        <ul class="small">
          @for (s of d.signals; track s) {
            <li>{{ s }}</li>
          }
        </ul>
        @if (canAnalyse()) {
          @if (analysis()?.order === d.order) {
            @let a = analysis()!;
            @if (a.suggestion; as sug) {
              <div class="ai">
                <p class="small label"><mat-icon inline>troubleshoot</mat-icon> Analyse de l'IA</p>
                @if (sug.review) {
                  <p class="small pre">{{ sug.review }}</p>
                }
                @if (sug.instructions) {
                  <p class="small label">Énigme proposée</p>
                  <p class="note">{{ sug.instructions }}</p>
                  @if (a.saved) {
                    <p class="small ok"><mat-icon inline>check_circle</mat-icon> Énigme remplacée dans votre Secret Track. Partagez une nouvelle version au catalogue quand vous voulez.</p>
                  } @else {
                    <button mat-flat-button type="button" (click)="keep(d, sug)" [disabled]="busy()"><mat-icon>done</mat-icon>Remplacer mon énigme</button>
                  }
                }
              </div>
            }
          } @else {
            <button mat-stroked-button type="button" (click)="analyse(d)" [disabled]="busy()">
              <mat-icon>troubleshoot</mat-icon>{{ busy() && pending() === d.order ? 'Analyse…' : 'Analyser avec l’IA' }}
            </button>
          }
        }
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .diag { padding: 10px 12px; border-radius: 12px; border: 2px solid var(--th-accent); background: color-mix(in srgb, var(--th-accent) 8%, transparent); }
    .diag.alert { border-color: color-mix(in srgb, var(--th-danger) 60%, transparent); background: color-mix(in srgb, var(--th-danger) 6%, transparent); }
    .head { margin: 0; }
    .head mat-icon { color: var(--th-danger); }
    ul { margin: 4px 0 8px; padding-left: 20px; }
    .ai { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--th-border); }
    .ai p { margin: 0; }
    .label { font-weight: 600; color: var(--th-primary); }
    .pre { white-space: pre-line; }
    .ok { color: var(--th-success); }
    .ai button { align-self: flex-start; }
  `,
})
export class StepDiagnosisPanel {
  readonly stats = input.required<HuntStats>();
  readonly reports = input<StepReport[]>([]);
  /** Durée annoncée, pour comparer le temps passé à chaque étape. */
  readonly durationMinutes = input<number | null>(null);
  /** Secret Track de l'auteur, où garder l'énigme corrigée ; null : pas d'analyse. */
  readonly huntId = input<number | null>(null);

  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly features = rxResource({ stream: () => this.api.getFeatures() });
  private readonly gps = rxResource({
    params: () => this.huntId() ?? undefined,
    stream: ({ params }) => this.api.gpsReliability(params),
    defaultValue: [],
  });

  protected readonly diagnosis = computed(() => {
    const open = new Map<number, number>();
    for (const r of this.reports()) if (r.status === 'open') open.set(r.stepOrder, (open.get(r.stepOrder) ?? 0) + 1);
    return diagnoseSteps(this.stats(), { durationMinutes: this.durationMinutes(), reports: open, gps: this.gps.value() });
  });
  protected readonly canAnalyse = computed(() => !!this.huntId() && !!this.features.value()?.assist);
  protected readonly busy = signal(false);
  protected readonly pending = signal<number | null>(null);
  protected readonly analysis = signal<{ order: number; step: Step; suggestion: AssistSuggestion | null; saved: boolean } | null>(null);

  /** L'énigme qui mène à l'étape k est celle de l'étape k − 1. */
  protected analyse(d: StepDiagnosis): void {
    const huntId = this.huntId();
    if (!huntId) return;
    this.busy.set(true);
    this.pending.set(d.order);
    this.api
      .getSteps(huntId)
      .pipe(
        switchMap((steps) => {
          const step = steps.find((s) => s.order === d.order - 1);
          if (!step?.instructions?.trim()) throw new Error('L’énigme qui mène à cette étape n’est pas rédigée dans votre Secret Track.');
          this.analysis.set({ order: d.order, step, suggestion: null, saved: false });
          return this.api.assist(step.id, { action: 'diagnose', instructions: step.instructions, hints: step.hints });
        }),
      )
      .subscribe({
        next: (r) => {
          this.analysis.update((a) => (a ? { ...a, suggestion: r.suggestion } : a));
          this.busy.set(false);
        },
        error: (e) => {
          this.analysis.set(null);
          this.busy.set(false);
          this.notify.error(e);
        },
      });
  }

  protected keep(d: StepDiagnosis, sug: AssistSuggestion): void {
    const a = this.analysis();
    if (!a || !sug.instructions) return;
    this.busy.set(true);
    this.api.saveStep({ id: a.step.id, huntId: a.step.huntId, instructions: sug.instructions }).subscribe({
      next: () => {
        this.analysis.set({ ...a, saved: true });
        this.busy.set(false);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
}
