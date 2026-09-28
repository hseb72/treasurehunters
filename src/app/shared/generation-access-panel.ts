import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { GENERATION_LIMITS, GENERATION_OFFERS, GenerationAccess, GenerationOffer } from '@shared/generation-access';
import { priceLabel } from '@shared/store';
import { HuntApi } from '../core/api';
import { Notify } from '../core/notify';

/**
 * Accès à la chasse sur mesure (§ 21) : ce qui réglera la prochaine chasse (fondateur,
 * forfait, crédit), ce qui reste, les limites d'usage, et les formules en vente.
 */
@Component({
  selector: 'th-generation-access',
  imports: [DatePipe, MatButtonModule, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let a = access();
    <div class="status">
      @if (!a.paid) {
        <p class="line"><mat-icon>redeem</mat-icon> Offerte pendant le lancement, dans la limite de {{ a.usage.daily }} chasses par jour.</p>
      } @else {
        @if (a.founder) {
          <p class="line"><mat-icon>star</mat-icon> <strong>Membre fondateur</strong> : chasses sur mesure incluses.</p>
        }
        @if (a.passUntil && passActive()) {
          <p class="line">
            <mat-icon>workspace_premium</mat-icon> Forfait jusqu'au <strong>{{ a.passUntil | date: 'd MMMM y' }}</strong>
            <span class="small muted">· {{ a.usage.passPeriod }} / {{ a.usage.passMonthly }} chasses sur 30 jours</span>
          </p>
        }
        @if (a.credits.available || a.credits.bonus) {
          <p class="line">
            <mat-icon>toll</mat-icon> <strong>{{ a.credits.available }}</strong> crédit{{ a.credits.available > 1 ? 's' : '' }}
            @if (a.credits.bonus) {
              <span class="small muted">· dont {{ a.credits.bonus }} gagné{{ a.credits.bonus > 1 ? 's' : '' }} grâce à vos chasses partagées</span>
            }
          </p>
        }
      }
      <p class="small muted">
        Aujourd'hui : {{ a.usage.today }} / {{ a.usage.daily }} chasses.
        <a routerLink="/conditions" fragment="chasse-sur-mesure">Limites d'usage</a>
      </p>
      @if (a.blocked) {
        <p class="line blocked"><mat-icon>hourglass_top</mat-icon> {{ a.blocked }}</p>
      }
    </div>

    @if (a.paid && (!a.right || showOffers())) {
      <div class="offers">
        @for (o of offers; track o.id) {
          <div class="offer">
            <mat-icon>{{ o.icon }}</mat-icon>
            <strong>{{ o.name }}</strong>
            <span class="small muted">{{ o.description }}</span>
            <span class="price">{{ price(o) }}</span>
            <button mat-flat-button type="button" (click)="buy(o)" [disabled]="busy()">{{ o.credits ? 'Acheter' : 'Choisir' }}</button>
          </div>
        }
      </div>
      <p class="small muted">
        Forfaits sans reconduction automatique. Partagez vos chasses au catalogue : chacune jouée par d'autres vous rapporte
        {{ limits.creatorBonusPerHunt }} crédits (jusqu'à {{ limits.creatorBonusMax }}).
      </p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; }
    .status p { margin: 0; }
    .status { display: flex; flex-direction: column; gap: 4px; }
    .line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .line mat-icon { color: var(--th-primary); }
    .blocked { color: var(--th-danger); }
    .blocked mat-icon { color: inherit; }
    .offers { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
    .offer {
      display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px;
      border: 1px solid var(--th-border); border-radius: 12px; background: var(--th-surface-raised);
    }
    .offer mat-icon { color: var(--th-primary); }
    .offer .price { font-size: 1.2rem; font-weight: 800; margin-top: auto; }
  `,
})
export class GenerationAccessPanel {
  private readonly api = inject(HuntApi);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);
  readonly access = input.required<GenerationAccess>();
  /** Montrer les formules même quand une chasse est déjà réglée (profil). */
  readonly showOffers = input(false);
  /** Où revenir après le paiement. */
  readonly returnPath = input('/generate');
  readonly changed = output<void>();
  protected readonly offers = GENERATION_OFFERS;
  protected readonly limits = GENERATION_LIMITS;
  protected readonly busy = signal(false);
  protected readonly price = (o: GenerationOffer) => priceLabel({ price: o.price, included: false });

  protected passActive(): boolean {
    const until = this.access().passUntil;
    return !!until && Date.parse(until) > Date.now();
  }

  protected buy(o: GenerationOffer): void {
    this.busy.set(true);
    this.api.checkout(o.id, this.returnPath()).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (!r.url) this.changed.emit();
        else if (r.url.startsWith('/')) this.router.navigateByUrl(r.url);
        else window.location.assign(r.url);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }
}
