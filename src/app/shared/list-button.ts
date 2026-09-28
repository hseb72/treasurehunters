import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ListsStore } from '../core/lists-store';
import { Session } from '../core/session';
import { NewList } from './new-list-dialog';

/**
 * Sur la fiche d'une Secret Track (§ 38) : le cœur la met dans « À faire » (ou l'en retire),
 * le menu l'ajoute à une autre liste, ou à une nouvelle.
 */
@Component({
  selector: 'th-list-button',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session.loggedIn()) {
      <div class="lists">
        @if (store.favorite(); as fav) {
          <button mat-stroked-button type="button" class="fav" [class.on]="inFavorite()" [attr.aria-pressed]="inFavorite()" (click)="store.toggle(fav.id, catalogId())">
            <mat-icon>{{ inFavorite() ? 'favorite' : 'favorite_border' }}</mat-icon>{{ inFavorite() ? 'Dans « À faire »' : 'À faire' }}
          </button>
        }
        <button mat-icon-button type="button" [matMenuTriggerFor]="menu" aria-label="Ajouter à une liste" title="Ajouter à une liste">
          <mat-icon>playlist_add</mat-icon>
        </button>
      </div>
      <mat-menu #menu="matMenu">
        @for (l of others(); track l.id) {
          <button mat-menu-item type="button" (click)="store.toggle(l.id, catalogId())">
            <mat-icon>{{ l.catalogIds.includes(catalogId()) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>{{ l.name }}
          </button>
        }
        <button mat-menu-item type="button" (click)="create()"><mat-icon>add</mat-icon>Nouvelle liste…</button>
        <a mat-menu-item routerLink="/listes"><mat-icon>list</mat-icon>Mes listes</a>
      </mat-menu>
    } @else {
      <a mat-stroked-button class="fav" routerLink="/login"><mat-icon>favorite_border</mat-icon>À faire</a>
    }
  `,
  styles: `
    .lists { display: inline-flex; align-items: center; gap: 4px; }
    .fav.on { color: var(--th-danger); border-color: currentColor; }
    .fav.on mat-icon { color: var(--th-danger); }
  `,
})
export class ListButton {
  readonly catalogId = input.required<number>();
  protected readonly store = inject(ListsStore);
  protected readonly session = inject(Session);
  private readonly newList = inject(NewList);

  protected readonly inFavorite = computed(() => this.store.favorite()?.catalogIds.includes(this.catalogId()) ?? false);
  protected readonly others = computed(() => this.store.lists().filter((l) => !(l.favorite && l.mine)));

  protected create(): void {
    this.newList.open().subscribe((l) => {
      if (l) this.store.toggle(l.id, this.catalogId());
    });
  }
}
