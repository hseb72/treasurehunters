import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { McpStats } from '@shared/mcp';

/** Libellés des outils MCP (§ 50), pour les relecteurs. */
const TOOL_LABELS: Record<string, string> = {
  search_secret_tracks: 'Recherche',
  get_secret_track: 'Fiche',
  surprise_me: 'Surprends-moi',
  upcoming_sessions: 'Sessions à venir',
  leaderboard: 'Classement',
};

/**
 * Usage du serveur MCP du catalogue (§ 50) : appels par outil, recherches sans résultat, fiches
 * ouvertes depuis un lien d'assistant, et les 30 derniers jours en barres.
 */
@Component({
  selector: 'th-mcp-stats',
  imports: [MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = stats();
    <p class="small muted">
      Fiches ouvertes depuis un assistant : <strong>{{ s.visits7 }}</strong> sur 7 jours, <strong>{{ s.visits30 }}</strong> sur 30 jours.
    </p>
    @if (s.tools.length) {
      <table class="small">
        <thead>
          <tr><th>Outil</th><th>7 j</th><th>30 j</th><th>Sans résultat</th><th>Erreurs</th></tr>
        </thead>
        <tbody>
          @for (t of s.tools; track t.tool) {
            <tr>
              <td>{{ label(t.tool) }}</td>
              <td>{{ t.calls7 }}</td>
              <td>{{ t.calls30 }}</td>
              <td>{{ t.empty30 }}</td>
              <td [class.bad]="t.errors30 > 0">{{ t.errors30 }}</td>
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <p class="small muted">Aucun appel ces 30 derniers jours.</p>
    }
    <div class="bars" role="img" [attr.aria-label]="'Appels par jour sur 30 jours, au plus ' + peak() + ' par jour'">
      @for (d of s.daily; track d.day) {
        <span class="bar" [style.height.%]="peak() ? (d.calls / peak()) * 100 : 0" [title]="d.day + ' : ' + d.calls + ' appels, ' + d.visits + ' visites'"></span>
      }
    </div>
    @if (s.topVisited.length) {
      <p class="small label">Les plus ouvertes depuis un assistant</p>
      <ol class="small top">
        @for (t of s.topVisited; track t.catalogId) {
          <li><a [routerLink]="['/catalog', t.catalogId]">{{ t.title }}</a> · {{ t.visits }}</li>
        }
      </ol>
    }
  `,
  styles: `
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: right; padding: 2px 4px; }
    th:first-child, td:first-child { text-align: left; }
    th { color: var(--th-ink-soft); font-weight: 600; }
    .bad { color: var(--th-danger); font-weight: 600; }
    .bars { display: flex; align-items: flex-end; gap: 2px; height: 48px; margin: 8px 0; border-bottom: 1px solid var(--th-border); }
    .bar { flex: 1; min-height: 1px; background: var(--th-primary-light); border-radius: 2px 2px 0 0; }
    .label { font-weight: 600; margin: 4px 0 0; }
    .top { margin: 0; padding-left: 20px; }
  `,
})
export class McpStatsView {
  readonly stats = input.required<McpStats>();
  protected readonly peak = computed(() => Math.max(0, ...this.stats().daily.map((d) => d.calls)));
  protected label(tool: string): string {
    return TOOL_LABELS[tool] ?? tool;
  }
}
