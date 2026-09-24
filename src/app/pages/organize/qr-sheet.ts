import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { QRCodeComponent } from 'angularx-qrcode';
import { filter, switchMap } from 'rxjs';
import { HuntApi } from '../../core/api';
import { Step } from '../../core/models';
import { Notify } from '../../core/notify';
import { Confirm } from '../../shared/confirm-dialog';
import { WorkspaceState } from './workspace-state';

/** Planche imprimable : un QR par étape (docs/conception.md § 4.1). */
@Component({
  selector: 'th-qr-sheet',
  imports: [MatButtonModule, MatIconModule, QRCodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './qr-sheet.html',
  styleUrl: './qr-sheet.scss',
})
export class QrSheetPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  protected readonly workspace = inject(WorkspaceState);

  private readonly steps = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.getSteps(params),
    defaultValue: [],
  });
  protected readonly printable = computed(() => this.steps.value().filter((s) => s.token));
  protected readonly finalOrder = computed(() => this.steps.value().length - 1);

  protected url(step: Step): string {
    return `${location.origin}/q/${step.token}`;
  }

  protected print(): void {
    window.print();
  }

  protected regenerate(step: Step): void {
    this.confirm
      .ask({
        title: `Nouveau QR pour l’étape ${step.order} ?`,
        message: 'L’ancien QR ne fonctionnera plus : il faudra réimprimer et remplacer celui posé sur place.',
        confirm: 'Régénérer',
        danger: true,
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.regenerateToken(step.id)),
      )
      .subscribe({
        next: () => this.steps.reload(),
        error: (e) => this.notify.error(e),
      });
  }
}
