import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RankingRow } from '@shared/models';
import { DurationPipe } from './format';

/** Podium des trois premières équipes (2ᵉ, 1ʳᵉ, 3ᵉ de gauche à droite). */
@Component({
  selector: 'th-podium',
  imports: [MatIconModule, DurationPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="podium">
      @for (p of places(); track p.row.teamId) {
        <div class="place place--{{ p.row.rank }}" [class.place--mine]="p.row.teamId === highlight()">
          <mat-icon class="medal">{{ p.row.rank === 1 ? 'trophy' : 'workspace_premium' }}</mat-icon>
          <div class="team">{{ p.row.teamName }}</div>
          <div class="time">{{ p.row.time | duration }}</div>
          <div class="block">{{ p.row.rank }}</div>
        </div>
      } @empty {
        <p class="muted center">Aucune équipe n'a atteint l'arrivée.</p>
      }
    </div>
  `,
  styleUrl: './podium.scss',
})
export class Podium {
  readonly rows = input.required<RankingRow[]>();
  /** Équipe à mettre en valeur (celle du joueur). */
  readonly highlight = input<number | null>(null);

  protected readonly places = computed(() => {
    const ranked = this.rows().filter((r) => r.rank !== null && r.rank <= 3);
    const order = [2, 1, 3];
    return order.map((rank) => ranked.find((r) => r.rank === rank)).filter((r) => !!r).map((row) => ({ row }));
  });
}
