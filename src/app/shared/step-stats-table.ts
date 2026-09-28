import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HuntStats, StepStats } from '@shared/models';

/**
 * Statistiques par étape (§ 22) : combien d'équipes ont trouvé, abandonné ou sont restées
 * bloquées, jokers et temps moyen. Les étapes difficiles ressortent : c'est là qu'il faut
 * retoucher l'énigme ou les jokers.
 */
@Component({
  selector: 'th-step-stats',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = stats();
    @if (!s.teams) {
      <p class="muted small">Pas encore de partie jouée : les chiffres apparaîtront avec les premières équipes.</p>
    } @else {
      <p class="small muted">
        {{ s.teams }} équipe{{ s.teams > 1 ? 's' : '' }} partie{{ s.teams > 1 ? 's' : '' }}, {{ s.finished }} arrivée{{ s.finished > 1 ? 's' : '' }}{{ s.plays > 1 ? ' (' + s.plays + ' chasses jouées)' : '' }}.
      </p>
      <ol class="steps">
        @for (st of s.steps; track st.order) {
          <li [class.hard]="hard(st)">
            <div class="head">
              <span class="order">{{ st.order }}</span>
              <strong class="title">{{ st.title }}</strong>
              @if (hard(st)) {
                <span class="flag small"><mat-icon inline>priority_high</mat-icon> étape difficile</span>
              }
            </div>
            @if (st.teams) {
              <div class="bar" [attr.aria-label]="st.found + ' trouvée(s), ' + st.skipped + ' abandon(s), ' + st.stuck + ' bloquée(s) sur ' + st.teams">
                <span class="found" [style.width.%]="pct(st.found, st.teams)"></span>
                <span class="skipped" [style.width.%]="pct(st.skipped, st.teams)"></span>
                <span class="stuck" [style.width.%]="pct(st.stuck, st.teams)"></span>
              </div>
              <div class="figures small muted">
                <span>{{ st.found }}/{{ st.teams }} trouvée{{ st.found > 1 ? 's' : '' }}</span>
                @if (st.skipped) {
                  <span>· {{ st.skipped }} abandon{{ st.skipped > 1 ? 's' : '' }}</span>
                }
                @if (st.stuck) {
                  <span>· {{ st.stuck }} bloquée{{ st.stuck > 1 ? 's' : '' }}</span>
                }
                <span>· {{ st.hints }} joker{{ st.hints > 1 ? 's' : '' }}</span>
                @if (st.avgMinutes !== null) {
                  <span>· {{ st.avgMinutes }} min en moyenne</span>
                }
              </div>
            } @else {
              <div class="figures small muted">Aucune équipe n'est encore arrivée jusque-là.</div>
            }
          </li>
        }
      </ol>
      <p class="legend small muted">
        <span class="dot found"></span> trouvée <span class="dot skipped"></span> abandonnée <span class="dot stuck"></span> bloquée (partie finie sans la trouver)
      </p>
    }
  `,
  styles: `
    .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    li { padding: 8px 10px; border-radius: 10px; background: var(--th-surface-sunken); }
    li.hard { outline: 2px solid color-mix(in srgb, var(--th-danger) 50%, transparent); }
    .head { display: flex; align-items: center; gap: 8px; }
    .order { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--th-primary); color: #fff; font-weight: 700; font-size: 0.8rem; flex: none; }
    .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .flag { color: var(--th-danger); font-weight: 600; white-space: nowrap; }
    .bar { display: flex; height: 8px; margin: 6px 0 4px; border-radius: 4px; overflow: hidden; background: var(--th-border); }
    .found, .dot.found { background: var(--th-success); }
    .skipped, .dot.skipped { background: var(--th-accent); }
    .stuck, .dot.stuck { background: var(--th-danger); }
    .figures { display: flex; flex-wrap: wrap; gap: 4px; }
    .legend { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
  `,
})
export class StepStatsTable {
  readonly stats = input.required<HuntStats>();

  protected pct(n: number, total: number): number {
    return total ? (n / total) * 100 : 0;
  }

  /** Une étape où au moins un tiers des équipes abandonne ou bloque, ou prend en moyenne plus d'un joker. */
  protected hard(s: StepStats): boolean {
    return s.teams >= 2 && ((s.skipped + s.stuck) / s.teams >= 1 / 3 || s.hints / s.teams > 1);
  }
}
