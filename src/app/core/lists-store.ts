import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { TrackList } from '@shared/lists';
import { Observable, tap } from 'rxjs';
import { HuntApi } from './api';
import { Notify } from './notify';
import { Session } from './session';

/**
 * Listes du joueur (§ 38), partagées par la fiche du catalogue (cœur « À faire », « Ajouter à
 * une liste ») et la page Mes listes. Rechargées à la connexion.
 */
@Injectable({ providedIn: 'root' })
export class ListsStore {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly session = inject(Session);

  readonly lists = signal<TrackList[]>([]);
  readonly favorite = computed(() => this.lists().find((l) => l.favorite && l.mine) ?? null);

  constructor() {
    effect(() => {
      if (this.session.user()) this.reload();
      else this.lists.set([]);
    });
  }

  reload(): void {
    this.api.myLists().subscribe({ next: (l) => this.lists.set(l), error: () => this.lists.set([]) });
  }

  has(listId: number, catalogId: number): boolean {
    return this.lists().find((l) => l.id === listId)?.catalogIds.includes(catalogId) ?? false;
  }

  /** Ajoute ou retire une Secret Track d'une liste. */
  toggle(listId: number, catalogId: number): void {
    const on = this.has(listId, catalogId);
    (on ? this.api.listRemove(listId, catalogId) : this.api.listAdd(listId, catalogId)).subscribe({
      next: (l) => this.put(l),
      error: (e) => this.notify.error(e),
    });
  }

  create(name: string, icon: string): Observable<TrackList> {
    return this.api.createList(name, icon).pipe(tap((l) => this.put(l)));
  }

  put(list: TrackList): void {
    this.lists.update((all) => (all.some((l) => l.id === list.id) ? all.map((l) => (l.id === list.id ? list : l)) : [...all, list]));
  }

  drop(id: number): void {
    this.lists.update((all) => all.filter((l) => l.id !== id));
  }
}
