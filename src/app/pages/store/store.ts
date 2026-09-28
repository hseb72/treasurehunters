import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { StoreItem } from '@shared/models';
import { priceLabel } from '@shared/store';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';
import { Shop } from '../../core/shop';

type Tab = 'skin' | 'tool' | 'pack';

/** Boutique d'extensions (§ 16) : univers graphiques et outils de jeu pour ses chasses. */
@Component({
  selector: 'th-store',
  imports: [MatButtonModule, MatIconModule],
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

  protected acquire(item: StoreItem): void {
    if (!this.session.loggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: '/store' } });
      return;
    }
    this.busy.set(item.id);
    this.shop.acquire(item.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.notify.info(
          item.kind === 'skin'
            ? `« ${item.name} » rejoint votre collection : choisissez-le dans l’onglet Infos d’une chasse.`
            : item.kind === 'pack'
              ? `« ${item.name} » rejoint votre collection : posez ses épreuves dans l’éditeur d’étapes.`
              : `« ${item.name} » rejoint votre collection : activez-le dans l’onglet Infos d’une chasse.`,
          6000,
        );
      },
      error: (e) => {
        this.busy.set(null);
        this.notify.error(e);
      },
    });
  }
}
