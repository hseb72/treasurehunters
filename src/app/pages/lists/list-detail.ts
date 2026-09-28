import { ChangeDetectionStrategy, Component, effect, inject, input, numberAttribute, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TrackList } from '@shared/lists';
import { HuntApi } from '../../core/api';
import { ListsStore } from '../../core/lists-store';
import { Notify } from '../../core/notify';
import { ShareLink } from '../../core/share';
import { DomTranslator } from '../../core/dom-translator';
import { Confirm } from '../../shared/confirm-dialog';
import { CatalogCard } from '../../shared/catalog-card';

/** Une liste (§ 38) : ses Secret Tracks, son partage, ses membres. */
@Component({
  selector: 'th-list-detail',
  imports: [CatalogCard, FormsModule, MatButtonModule, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack">
      <a mat-button routerLink="/listes"><mat-icon>arrow_back</mat-icon>Mes listes</a>
      @if (list.error()) {
        <section class="surface center"><p class="muted">Cette liste n'existe pas, ou vous n'en êtes pas membre.</p></section>
      }
      @if (list.value(); as l) {
        <header class="head">
          <mat-icon class="icon">{{ l.icon }}</mat-icon>
          @if (renaming()) {
            <form class="rename" (ngSubmit)="rename(l)">
              <input name="name" maxlength="60" [ngModel]="name()" (ngModelChange)="name.set($event)" aria-label="Nom de la liste" />
              <button mat-flat-button type="submit" [disabled]="!name().trim()">Renommer</button>
            </form>
          } @else {
            <h1>{{ l.name }}</h1>
            @if (l.mine && !l.favorite) {
              <button mat-icon-button type="button" (click)="name.set(l.name); renaming.set(true)" aria-label="Renommer"><mat-icon>edit</mat-icon></button>
            }
          }
        </header>
        <p class="small muted">
          @if (l.mine) {
            Votre liste
          } @else {
            Liste de {{ l.ownerNickname }}
          }
          @if (l.members.length) {
            · avec {{ l.members.join(', ') }}
          }
        </p>

        @if (!l.favorite) {
          <section class="surface share">
            @if (l.code) {
              <mat-icon>group</mat-icon>
              <p class="small">Liste partagée : ses membres y ajoutent et en retirent des Secret Tracks. Code <strong class="code">{{ l.code }}</strong></p>
              <button mat-stroked-button type="button" (click)="invite(l)"><mat-icon>share</mat-icon>Inviter</button>
              @if (l.mine) {
                <button mat-button type="button" (click)="setShared(l, false)">Ne plus partager</button>
              }
            } @else if (l.mine) {
              <mat-icon>group_add</mat-icon>
              <p class="small">Remplissez-la à plusieurs : partagez-la, vos amis la rejoignent avec son code.</p>
              <button mat-stroked-button type="button" (click)="setShared(l, true)"><mat-icon>share</mat-icon>Partager</button>
            }
          </section>
        }

        @if (l.entries.length) {
          <div class="grid">
            @for (e of l.entries; track e.id) {
              <div class="item">
                <th-catalog-card [entry]="e" />
                <button mat-button type="button" (click)="remove(l, e.id)"><mat-icon>remove_circle_outline</mat-icon>Retirer de la liste</button>
              </div>
            }
          </div>
        } @else {
          <section class="surface center">
            <mat-icon>bookmark_border</mat-icon>
            <p class="muted">Liste vide : ajoutez-y des Secret Tracks depuis leur fiche du catalogue.</p>
            <a mat-stroked-button routerLink="/catalog">Parcourir le catalogue</a>
          </section>
        }

        <div class="line end">
          @if (!l.mine) {
            <button mat-button type="button" (click)="leave(l)"><mat-icon>logout</mat-icon>Quitter la liste</button>
          } @else if (!l.favorite) {
            <button mat-button type="button" class="danger" (click)="remove_(l)"><mat-icon>delete</mat-icon>Supprimer la liste</button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .head { display: flex; align-items: center; gap: 10px; }
    .head h1 { margin: 0; }
    .head .icon { color: var(--th-primary); width: 32px; height: 32px; font-size: 32px; }
    .rename { display: flex; gap: 8px; flex: 1; }
    .rename input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--th-border); border-radius: 10px; font: inherit; background: var(--th-surface-raised); color: var(--th-ink); }
    .share { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 16px; }
    .share p { flex: 1 1 220px; margin: 0; }
    .share mat-icon { color: var(--th-primary); }
    .code { letter-spacing: 0.1em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .item { display: flex; flex-direction: column; gap: 4px; }
    .item button { align-self: flex-end; }
    .danger { color: var(--th-danger); }
  `,
})
export class ListDetailPage {
  private readonly api = inject(HuntApi);
  private readonly store = inject(ListsStore);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  private readonly confirm = inject(Confirm);
  private readonly shareLink = inject(ShareLink);
  private readonly i18n = inject(DomTranslator);

  readonly id = input.required({ transform: numberAttribute });
  protected readonly list = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.getList(params) });
  protected readonly renaming = signal(false);
  protected readonly name = signal('');

  /** Version anglaise (§ 33) : titres et présentations des Secret Tracks de la liste. */
  private readonly translateContent = effect(() => {
    const ids = this.list.value()?.entries.map((e) => e.id) ?? [];
    if (ids.length) untracked(() => this.i18n.requestContent({ catalog: ids.slice(0, 30) }));
  });

  private saved(l: TrackList): void {
    this.store.put(l);
    this.list.reload();
  }

  protected rename(l: TrackList): void {
    this.api.updateList(l.id, { name: this.name().trim() }).subscribe({
      next: (x) => {
        this.renaming.set(false);
        this.saved(x);
      },
      error: (e) => this.notify.error(e),
    });
  }

  protected setShared(l: TrackList, shared: boolean): void {
    this.api.updateList(l.id, { shared }).subscribe({ next: (x) => this.saved(x), error: (e) => this.notify.error(e) });
  }

  protected invite(l: TrackList): void {
    const url = `${location.origin}/listes?rejoindre=${l.code}`;
    void this.shareLink.share(l.name, this.i18n.t(`Rejoins ma liste de Secret Tracks « ${l.name} » (code ${l.code}) :`), url);
  }

  protected remove(l: TrackList, catalogId: number): void {
    this.api.listRemove(l.id, catalogId).subscribe({ next: (x) => this.saved(x), error: (e) => this.notify.error(e) });
  }

  protected leave(l: TrackList): void {
    this.api.leaveList(l.id).subscribe({
      next: () => {
        this.store.drop(l.id);
        void this.router.navigate(['/listes']);
      },
      error: (e) => this.notify.error(e),
    });
  }

  protected remove_(l: TrackList): void {
    this.confirm.ask({ title: `Supprimer « ${l.name} » ?`, message: 'La liste disparaît, pour vous et ses membres. Les Secret Tracks restent au catalogue.', confirm: 'Supprimer' }).subscribe((ok) => {
      if (!ok) return;
      this.api.deleteList(l.id).subscribe({
        next: () => {
          this.store.drop(l.id);
          void this.router.navigate(['/listes']);
        },
        error: (e) => this.notify.error(e),
      });
    });
  }
}
