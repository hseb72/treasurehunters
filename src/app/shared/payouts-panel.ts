import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { HuntApi } from '../core/api';
import { Notify } from '../core/notify';
import { Shop } from '../core/shop';

/**
 * Compte vendeur (§ 20) : pour être payé de ses créations et de ses chasses du catalogue, le
 * créateur s'inscrit chez Stripe Connect. Rien ne s'affiche tant que le paiement n'est pas activé.
 */
@Component({
  selector: 'th-payouts-panel',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shop.payments() && account.value(); as a) {
      <section class="surface payouts">
        <mat-icon>{{ a.ready ? 'verified' : 'account_balance' }}</mat-icon>
        <div class="text">
          @if (a.ready) {
            <strong>Vos ventes vous sont versées</strong>
            <span class="small muted">Stripe vous reverse chaque vente, moins la commission de {{ a.commissionPercent }} % de SecretTracks.</span>
          } @else {
            <strong>Recevez le fruit de vos ventes</strong>
            <span class="small muted">
              {{ a.account ? 'Terminez votre inscription chez Stripe' : 'Inscrivez-vous chez Stripe, notre prestataire de paiement' }} : vos {{ what() }} à prix
              deviennent achetables, et vous touchez chaque vente moins {{ a.commissionPercent }} % de commission.
            </span>
          }
        </div>
        @if (!a.ready) {
          <button mat-flat-button type="button" (click)="start()" [disabled]="busy()"><mat-icon>open_in_new</mat-icon>{{ a.account ? 'Reprendre' : 'Activer mes paiements' }}</button>
        }
      </section>
    }
  `,
  styles: `
    .payouts { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .payouts > mat-icon { color: var(--th-primary); }
    .text { display: flex; flex-direction: column; flex: 1 1 260px; }
  `,
})
export class PayoutsPanel {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  protected readonly shop = inject(Shop);
  /** Ce que vend l'utilisateur, pour le texte : « créations », « chasses ». */
  readonly what = input('créations');
  protected readonly busy = signal(false);
  protected readonly account = rxResource({ params: () => this.shop.payments() || undefined, stream: () => this.api.payoutAccount() });

  protected start(): void {
    this.busy.set(true);
    this.api.startPayouts(this.router.url.split('?')[0]).subscribe({
      next: ({ url }) => {
        if (url.startsWith('/')) {
          this.busy.set(false);
          this.account.reload();
          this.notify.info('Paiements activés : vos ventes vous seront versées.');
        } else window.location.assign(url);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
}
