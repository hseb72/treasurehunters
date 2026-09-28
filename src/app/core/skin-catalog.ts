import { effect, inject, Injectable, signal } from '@angular/core';
import { knownSkin, registerSkin } from '@shared/skins';
import { HuntApi } from './api';
import { Shop } from './shop';

/**
 * Skins de créateurs (§ 19) : ceux de la boutique sont connus dès qu'elle est chargée ; celui
 * d'une chasse qui en habille une autre (« u12 ») est demandé au serveur. `version` change à
 * chaque ajout, pour que l'habillage se refasse.
 */
@Injectable({ providedIn: 'root' })
export class SkinCatalog {
  private readonly api = inject(HuntApi);
  private readonly shop = inject(Shop);
  readonly version = signal(0);
  private readonly pending = new Set<string>();

  constructor() {
    effect(() => {
      let added = false;
      for (const item of this.shop.items.value()) {
        if (item.skin && !knownSkin(item.skin.id)) {
          registerSkin(item.skin);
          added = true;
        }
      }
      if (added) this.version.update((v) => v + 1);
    });
  }

  /** Charge au besoin le skin de créateur `id` (sans effet pour un skin intégré). */
  ensure(id: string | null | undefined): void {
    if (!id || !/^u\d+$/.test(id) || knownSkin(id) || this.pending.has(id)) return;
    this.pending.add(id);
    this.api.creatorSkin(id).subscribe({
      next: (skin) => {
        registerSkin(skin);
        this.version.update((v) => v + 1);
      },
      error: () => this.pending.delete(id),
    });
  }
}
