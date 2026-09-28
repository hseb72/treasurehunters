import { computed, inject, Injectable } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { filter, map, Observable, tap } from 'rxjs';
import { StoreItem } from '@shared/models';
import { priceLabel } from '@shared/store';
import { HuntApi } from './api';
import { Session } from './session';

/**
 * Boutique d'extensions (§ 16) : ce qu'elle propose et ce que possède le joueur connecté,
 * partagé par la page Boutique, le choix de l'univers et les outils d'une chasse.
 */
@Injectable({ providedIn: 'root' })
export class Shop {
  private readonly api = inject(HuntApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  /** Paiement activé sur le serveur (§ 20) ; sinon tout s'obtient gratuitement. */
  private readonly features = rxResource({ stream: () => this.api.getFeatures() });
  readonly payments = computed(() => !!this.features.value()?.payments);

  readonly items = rxResource({
    params: () => this.session.user()?.id ?? 0,
    stream: () => this.api.getStore(),
    defaultValue: [] as StoreItem[],
  });
  private readonly owned = computed(() => new Set(this.items.value().filter((i) => i.owned).map((i) => i.id)));

  owns(productId: string): boolean {
    return this.owned().has(productId);
  }

  item(productId: string): StoreItem | undefined {
    return this.items.value().find((i) => i.id === productId);
  }

  /** Obtenir une extension gratuite (ou toutes, tant que le paiement n'est pas activé). */
  acquire(productId: string): Observable<StoreItem[]> {
    return this.api.acquire(productId).pipe(tap((items) => this.items.set(items)));
  }

  /** Ce que coûte l'obtention : « offert » sans paiement ou si c'est gratuit, sinon le prix. */
  offer(productId: string): string {
    const item = this.item(productId);
    return !this.payments() || !item || item.included || !item.price ? 'offert' : priceLabel(item);
  }

  /**
   * Obtenir une extension, ou une chasse du catalogue (« hunt:c12 ») : gratuite, tout de suite ;
   * payante, direction la page de paiement (le flux ne rend alors rien : on quitte la page).
   * `returnPath` : où revenir après le paiement.
   */
  obtain(productId: string, returnPath = this.router.url.split('?')[0]): Observable<StoreItem[]> {
    if (!this.payments()) return this.acquire(productId);
    return this.api.checkout(productId, returnPath).pipe(
      tap((r) => {
        if (!r.url) this.items.set(r.items);
        else if (r.url.startsWith('/')) this.router.navigateByUrl(r.url);
        else window.location.assign(r.url);
      }),
      filter((r) => !r.url),
      map((r) => r.items),
    );
  }
}
