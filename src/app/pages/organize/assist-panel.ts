import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ASSIST_ACTIONS, AssistAction, AssistSuggestion } from '@shared/assist';
import { HuntApi } from '../../core/api';
import { AssistMeter } from '../../core/assist-meter';
import { AssistMeterView } from '../../shared/assist-meter';

/**
 * Assistant de rédaction de l'éditeur d'étapes (§ 25). L'IA propose, l'organisateur choisit :
 * rien ne remplace son texte sans son accord. Le décompte des suggestions reste sous ses yeux.
 */
@Component({
  selector: 'th-assist-panel',
  imports: [AssistMeterView, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <mat-icon>auto_awesome</mat-icon>
      <strong>Assistant de rédaction</strong>
      <span class="small muted">· 1 suggestion par demande</span>
    </div>
    @if (meter.usage(); as u) {
      <th-assist-meter [usage]="u" />
    }

    <div class="actions">
      @if (empty()) {
        <button mat-stroked-button type="button" (click)="ask('rephrase')" [disabled]="!!busy() || blocked()" title="Une première énigme qui mène au lieu suivant">
          <mat-icon>{{ busy() === 'rephrase' ? 'hourglass_top' : 'edit_note' }}</mat-icon>Proposer une énigme
        </button>
      } @else {
        @for (a of actions; track a.id) {
          <button mat-stroked-button type="button" (click)="ask(a.id)" [disabled]="!!busy() || blocked()" [title]="a.description">
            <mat-icon>{{ busy() === a.id ? 'hourglass_top' : a.icon }}</mat-icon>{{ a.label }}
          </button>
        }
      }
    </div>
    @if (meter.usage()?.blocked; as why) {
      <p class="small blocked"><mat-icon inline>hourglass_top</mat-icon> {{ why }}</p>
    }
    @if (error(); as e) {
      <p class="small blocked" role="alert">{{ e }}</p>
    }

    @if (suggestion(); as s) {
      <div class="proposal" role="region" aria-label="Proposition de l'assistant">
        @if (s.review) {
          <p class="review">{{ s.review }}</p>
        }
        @if (s.instructions) {
          <span class="small muted">{{ s.action === 'review' ? 'Version corrigée proposée' : 'Énigme proposée' }}</span>
          <p class="note text">{{ s.instructions }}</p>
        }
        @if (s.hints?.length) {
          <span class="small muted">Jokers proposés, du plus discret au plus direct</span>
          <ol>
            @for (h of s.hints; track $index) {
              <li>{{ h }}</li>
            }
          </ol>
        }
        <div class="row">
          <button mat-button type="button" (click)="suggestion.set(null)">Ignorer</button>
          @if (s.instructions) {
            <button mat-flat-button type="button" (click)="useInstructions(s.instructions)"><mat-icon>check</mat-icon>Remplacer mon énigme</button>
          }
          @if (s.hints?.length) {
            <button mat-flat-button type="button" (click)="useHints(s.hints!)"><mat-icon>check</mat-icon>Utiliser ces jokers</button>
          }
        </div>
        <p class="small muted">Relisez avant d'enregistrer : l'IA ne connaît pas le terrain aussi bien que vous.</p>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 12px; border: 1px dashed var(--th-border); }
    .head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .head mat-icon { color: var(--th-primary); }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .blocked { margin: 0; color: var(--th-danger); }
    .proposal { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 10px; background: var(--th-surface-sunken); }
    .proposal p, .proposal ol { margin: 0; }
    .text, .review { white-space: pre-line; }
    .row { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
  `,
})
export class AssistPanel {
  private readonly api = inject(HuntApi);
  protected readonly meter = inject(AssistMeter);

  readonly stepId = input.required<number>();
  readonly instructions = input('');
  readonly hints = input<string[]>([]);
  readonly applyInstructions = output<string>();
  readonly applyHints = output<string[]>();

  protected readonly actions = ASSIST_ACTIONS;
  protected readonly busy = signal<AssistAction | null>(null);
  protected readonly suggestion = signal<AssistSuggestion | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly empty = computed(() => !this.instructions().trim());
  protected readonly blocked = computed(() => !!this.meter.usage()?.blocked);

  protected ask(action: AssistAction): void {
    this.busy.set(action);
    this.error.set(null);
    this.suggestion.set(null);
    this.api.assist(this.stepId(), { action, instructions: this.instructions(), hints: this.hints() }).subscribe({
      next: (r) => {
        this.busy.set(null);
        this.suggestion.set(r.suggestion);
        this.meter.usage.set(r.usage);
      },
      error: (e) => {
        this.busy.set(null);
        this.error.set(e?.message ?? 'L’assistant n’a pas pu répondre.');
        this.meter.reload();
      },
    });
  }

  protected useInstructions(text: string): void {
    this.applyInstructions.emit(text);
    this.suggestion.set(null);
  }

  protected useHints(hints: string[]): void {
    this.applyHints.emit(hints);
    this.suggestion.set(null);
  }
}
