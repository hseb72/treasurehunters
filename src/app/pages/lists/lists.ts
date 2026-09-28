import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ListsStore } from '../../core/lists-store';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';
import { NewList } from '../../shared/new-list-dialog';

/**
 * Mes listes (§ 38) : « À faire », mes listes, celles que j'ai rejointes ; rejoindre une liste
 * partagée par son code (« /listes?rejoindre=CODE », le lien que l'on envoie).
 */
@Component({
  selector: 'th-lists',
  imports: [FormsModule, MatButtonModule, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack">
      <header class="line head">
        <h1>Mes listes</h1>
        <button mat-flat-button type="button" (click)="create()"><mat-icon>add</mat-icon>Nouvelle liste</button>
      </header>
      <p class="muted small">
        Gardez les Secret Tracks qui vous tentent : le cœur « À faire » sur leur fiche, ou vos propres listes (« Week-end à Toulouse »,
        « Avec les enfants »…). Partagez une liste pour la remplir à plusieurs.
      </p>

      <div class="grid">
        @for (l of store.lists(); track l.id) {
          <a class="surface list" [routerLink]="['/listes', l.id]">
            <mat-icon class="icon">{{ l.icon }}</mat-icon>
            <span class="name">{{ l.name }}</span>
            <span class="small muted">
              {{ l.catalogIds.length }} Secret Track{{ l.catalogIds.length > 1 ? 's' : '' }}
              @if (!l.mine) {
                · liste de {{ l.ownerNickname }}
              } @else if (l.code) {
                · partagée
              }
            </span>
          </a>
        }
      </div>

      <form class="surface join" (ngSubmit)="join()">
        <mat-icon>group_add</mat-icon>
        <label for="list-code">Un ami vous a donné le code de sa liste ?</label>
        <input id="list-code" name="code" [ngModel]="code()" (ngModelChange)="code.set($event)" autocomplete="off" placeholder="Code de la liste" maxlength="12" />
        <button mat-stroked-button type="submit" [disabled]="code().trim().length < 4">Rejoindre</button>
      </form>
    </div>
  `,
  styles: `
    .head { justify-content: space-between; }
    .head h1 { margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .list { display: flex; flex-direction: column; gap: 4px; padding: 16px; text-decoration: none; color: var(--th-ink); }
    .list .icon { color: var(--th-primary); }
    .list .name { font-weight: 700; }
    .join { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; }
    .join mat-icon { color: var(--th-primary); }
    .join input { flex: 1 1 140px; min-width: 0; padding: 8px 10px; border: 1px solid var(--th-border); border-radius: 10px; font: inherit; text-transform: uppercase; background: var(--th-surface-raised); color: var(--th-ink); }
  `,
})
export class ListsPage {
  protected readonly store = inject(ListsStore);
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  private readonly newList = inject(NewList);

  /** « ?rejoindre=CODE » : le lien d'une liste partagée. */
  readonly rejoindre = input<string | undefined>();
  protected readonly code = signal('');

  constructor() {
    this.store.reload();
    effect(() => {
      const code = this.rejoindre();
      if (code) untracked(() => this.join(code));
    });
  }

  protected create(): void {
    this.newList.open().subscribe((l) => {
      if (l) void this.router.navigate(['/listes', l.id]);
    });
  }

  protected join(code = this.code()): void {
    this.api.joinList(code.trim()).subscribe({
      next: (l) => {
        this.store.put(l);
        this.notify.info(`Vous avez rejoint « ${l.name} ».`);
        void this.router.navigate(['/listes', l.id]);
      },
      error: (e) => this.notify.error(e),
    });
  }
}
