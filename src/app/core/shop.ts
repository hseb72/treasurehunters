import { computed, inject, Injectable } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Observable, tap } from 'rxjs';
import { StoreItem } from '@shared/models';
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

  /** Obtenir une extension (offerte pour l'instant). */
  acquire(productId: string): Observable<StoreItem[]> {
    return this.api.acquire(productId).pipe(tap((items) => this.items.set(items)));
  }
}
