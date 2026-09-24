import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
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
  imports: [DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, RouterLink, HuntCard],
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

  protected readonly running = computed(() => this.mine.value().filter((h) => h.status === 'running'));
  protected readonly upcoming = computed(() => this.mine.value().filter((h) => h.status === 'published'));
  protected readonly archives = computed(() =>
    this.mine
      .value()
      .filter((h) => h.status === 'closed' || h.status === 'archived')
      .reverse(),
  );
  protected readonly discover = computed(() => {
    const mineIds = new Set(this.mine.value().map((h) => h.id));
    return this.open.value().filter((h) => !mineIds.has(h.id) && h.status !== 'closed');
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
