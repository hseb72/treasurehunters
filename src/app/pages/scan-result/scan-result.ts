import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { HuntApi } from '../../core/api';
import { Clock } from '../../core/clock';
import { Session } from '../../core/session';
import { formatClock } from '../../shared/format';
import { Podium } from '../../shared/podium';

/** Page ouverte par un QR code : https://<domaine>/q/<jeton> (docs/conception.md § 4). */
import { PlacePhoto } from '../../shared/place-photo';
import { SkinDirective, SkinEffects } from '../../shared/skin';

@Component({
  selector: 'th-scan-result',
  imports: [SkinDirective, DatePipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule, RouterLink, Podium, PlacePhoto],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scan-result.html',
  styleUrl: './scan-result.scss',
})
export class ScanResultPage {
  private readonly api = inject(HuntApi);
  private readonly session = inject(Session);
  private readonly clock = inject(Clock);

  readonly token = input.required<string>();

  // Le scan est rejoué si l'utilisateur se connecte depuis cette page.
  protected readonly result = rxResource({
    params: () => ({ token: this.token(), user: this.session.user()?.id }),
    stream: ({ params }) => this.api.scan(params.token),
  });
  /** Skin de la chasse, dès qu'elle est connue. */
  protected readonly skin = computed(() => this.result.value()?.hunt?.skin);
  private readonly fx = inject(SkinEffects);

  constructor() {
    // Son et animation du skin, une fois par étape validée.
    let celebrated: unknown = null;
    effect(() => {
      const r = this.result.value();
      if (r?.outcome !== 'validated' || r === celebrated) return;
      celebrated = r;
      if (r.step?.isFinal) this.fx.treasure(this.skin());
      else this.fx.validated(this.skin());
    });
  }

  protected countdown(iso: string | null | undefined): string {
    return iso ? formatClock(Date.parse(iso) - this.clock.now()) : '';
  }

  protected get loginLink() {
    return { returnUrl: `/q/${this.token()}` };
  }
}
