import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HuntStatus } from '../core/models';
import { STATUS_ICONS, STATUS_LABELS } from './labels';

@Component({
  selector: 'th-status-badge',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge badge--{{ status() }}"><mat-icon>{{ icon() }}</mat-icon>{{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<HuntStatus>();
  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
  protected readonly icon = computed(() => STATUS_ICONS[this.status()]);
}
