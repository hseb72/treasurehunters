import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { take, takeWhile, timer } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { StoreItem } from '@shared/models';
import { priceLabel } from '@shared/store';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';
import { Shop } from '../../core/shop';

type Tab = 'skin' | 'tool' | 'pack';

/** Boutique d'extensions (§ 16) : univers graphiques et outils de jeu pour ses chasses. */
@Component({
  selector: 'th-store',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './store.html',
  styleUrl: './store.scss',
})
export class StorePage {
  protected readonly shop = inject(Shop);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);

  protected readonly tab = signal<Tab>('skin');
  protected readonly tabs: { value: Tab; label: string; icon: string }[] = [
    { value: 'skin', label: 'Univers', icon: 'palette' },
    { value: 'tool', label: 'Outils', icon: 'construction' },
    { value: 'pack', label: 'Packs d’énigmes', icon: 'extension' },
  ];
  protected readonly items = computed(() => this.shop.items.value().filter((i) => i.kind === this.tab()));
  protected readonly busy = signal<string | null>(null);
  protected readonly price = priceLabel;

  /** Retour de la page de paiement (§ 20) : « ?paid=1&product=… », ou 0 si annulé. */
  readonly paid = input<string | undefined>();
  readonly product = input<string | undefined>();

  constructor() {
    effect(() => {
      const paid = this.paid();
      const product = this.product();
      if (paid === undefined) return;
      untracked(() => {
        this.router.navigate([], { queryParams: {}, replaceUrl: true });
        if (paid !== '1') {
          this.notify.info('Paiement annulé : rien n’a été débité.');
          return;
        }
        this.notify.info('Paiement reçu, merci ! L’extension rejoint votre collection.', 6000);
        const kind = product?.split(':')[0];
        if (kind === 'skin' || kind === 'tool' || kind === 'pack') this.tab.set(kind);
        // La confirmation de Stripe peut arriver quelques secondes après le retour.
        timer(0, 2000)
          .pipe(take(6), takeWhile(() => !product || !this.shop.owns(product)))
          .subscribe(() => this.shop.items.reload());
      });
    });
  }

  protected acquire(item: StoreItem): void {
    if (!this.session.loggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: '/store' } });
      return;
    }
    this.busy.set(item.id);
    this.shop.obtain(item.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.notify.info(
          item.kind === 'skin'
            ? `« ${item.name} » rejoint votre collection : choisissez-le dans l’onglet Infos d’une Secret Track.`
            : item.kind === 'pack'
              ? `« ${item.name} » rejoint votre collection : posez ses épreuves dans l’éditeur d’étapes.`
              : `« ${item.name} » rejoint votre collection : activez-le dans l’onglet Infos d’une Secret Track.`,
          6000,
        );
      },
      error: (e) => {
        this.busy.set(null);
        this.notify.error(e);
      },
      complete: () => this.busy.set(null),
    });
  }
}
