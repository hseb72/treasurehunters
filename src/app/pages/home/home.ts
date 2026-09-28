import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DomTranslator } from '../../core/dom-translator';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { HuntApi } from '../../core/api';
import { Clock } from '../../core/clock';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';
import { formatClock } from '../../shared/format';
import { HuntCard } from '../../shared/hunt-card';

@Component({
  selector: 'th-home',
  imports: [DatePipe, FormsModule, MatButtonModule, MatIconModule, RouterLink, HuntCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomePage {
  private readonly api = inject(HuntApi);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);
  protected readonly session = inject(Session);
  protected readonly clock = inject(Clock);

  protected readonly code = signal('');
  protected readonly query = signal('');
  protected readonly chips = [
    { value: 'all', label: 'Toutes' },
    { value: 'soon', label: 'Bientôt' },
    { value: 'popular', label: 'Populaires' },
    { value: 'new', label: 'Nouveautés' },
  ] as const;
  protected readonly chip = signal<(typeof this.chips)[number]['value']>('all');

  private readonly mine = rxResource({
    params: () => this.session.user()?.id,
    stream: ({ params }) => (params ? this.api.listHunts('playing') : of([])),
    defaultValue: [],
  });
  private readonly open = rxResource({
    params: () => this.session.user()?.id ?? 0,
    stream: () => this.api.listHunts('public'),
    defaultValue: [],
  });

  /** Version anglaise (§ 33) : noms, lieux et trésors des expéditions affichées. */
  private readonly i18n = inject(DomTranslator);
  private readonly translateContent = effect(() => {
    const ids = [...new Set([...this.mine.value(), ...this.open.value()].map((h) => h.id))];
    if (ids.length) untracked(() => this.i18n.requestContent({ info: ids.slice(0, 30) }));
  });

  protected readonly running = computed(() => this.mine.value().filter((h) => h.status === 'running'));
  protected readonly upcoming = computed(() => this.mine.value().filter((h) => h.status === 'published' && !h.surprise));
  /** Chasses surprises prêtes : le joueur donne le départ quand il veut. */
  protected readonly surprises = computed(() => this.mine.value().filter((h) => h.status === 'published' && h.surprise));
  protected readonly archives = computed(() =>
    this.mine
      .value()
      .filter((h) => h.status === 'closed' || h.status === 'archived')
      .reverse(),
  );
  protected readonly discover = computed(() => {
    const mineIds = new Set(this.mine.value().map((h) => h.id));
    const q = this.query().trim().toLowerCase();
    const list = this.open
      .value()
      .filter((h) => !mineIds.has(h.id) && h.status !== 'closed')
      .filter((h) => !q || [h.name, h.location, h.description].some((t) => t.toLowerCase().includes(q)));
    switch (this.chip()) {
      case 'soon':
        return [...list].sort((a, b) => a.begin.localeCompare(b.begin));
      case 'popular':
        return [...list].sort((a, b) => b.teamCount - a.teamCount);
      case 'new':
        return [...list].sort((a, b) => b.id - a.id);
      default:
        return list;
    }
  });

  protected countdown(iso: string): string {
    return formatClock(Date.parse(iso) - this.clock.now());
  }

  protected joinWithCode(): void {
    const code = this.code().trim();
    if (!code) return;
    this.api.findHuntByCode(code).subscribe({
      next: (hunt) => this.router.navigate(['/hunts', hunt.id], { queryParams: { code: code.toUpperCase() } }),
      error: (e) => this.notify.error(e),
    });
  }
}
