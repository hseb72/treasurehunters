import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HuntApi } from '../../core/api';
import { Team } from '../../core/models';
import { Notify } from '../../core/notify';
import { WorkspaceState } from './workspace-state';

@Component({
  selector: 'th-teams-panel',
  imports: [CdkDrag, CdkDropList, DatePipe, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './teams-panel.html',
  styleUrl: './teams-panel.scss',
})
export class TeamsPanelPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  protected readonly workspace = inject(WorkspaceState);

  private readonly teams = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.getTeams(params),
    defaultValue: [],
  });

  /** Ordre de passage en cours d'édition. */
  protected readonly order = linkedSignal<Team[]>(() => this.teams.value());
  protected readonly dirty = signal(false);

  protected readonly hunt = computed(() => this.workspace.hunt.value());
  protected readonly canOrder = computed(() => this.hunt()?.startMode === 'staggered' && this.hunt()?.status === 'published');
  protected readonly inviteUrl = computed(() => {
    const h = this.hunt();
    return h ? `${location.origin}/hunts/${h.id}?code=${h.joinCode}` : '';
  });

  /** Heure de départ prévue d'après la position dans la liste. */
  protected plannedStart(index: number): string | null {
    const h = this.hunt();
    if (!h) return null;
    const offset = h.startMode === 'staggered' ? index * (h.interval ?? 0) * 60_000 : 0;
    return new Date(Date.parse(h.begin) + offset).toISOString();
  }

  protected drop(event: CdkDragDrop<Team[]>): void {
    const list = [...this.order()];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    this.order.set(list);
    this.dirty.set(true);
  }

  protected shuffle(): void {
    const list = [...this.order()];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    this.order.set(list);
    this.dirty.set(true);
  }

  protected saveOrder(): void {
    this.api.setStartOrder(this.workspace.huntId(), this.order().map((t) => t.id)).subscribe({
      next: (teams) => {
        this.teams.set(teams);
        this.dirty.set(false);
        this.notify.info('Ordre de passage enregistré.');
      },
      error: (e) => this.notify.error(e),
    });
  }

  protected copyInvite(): void {
    navigator.clipboard?.writeText(this.inviteUrl()).then(() => this.notify.info('Lien d’invitation copié.'));
  }
}
