import { ChangeDetectionStrategy, Component, inject, input, numberAttribute } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { HuntApi } from '../../core/api';
import { CatalogCard } from '../../shared/catalog-card';
import { Stars } from '../../shared/stars';

/** Fiche publique d'un organisateur : sa note (s'il accepte d'être noté) et ses chasses au catalogue. */
@Component({
  selector: 'th-organizer',
  imports: [CatalogCard, MatButtonModule, MatIconModule, RouterLink, Stars],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack">
      @if (profile.error()) {
        <section class="parchment center">
          <p>Organisateur introuvable.</p>
          <a mat-stroked-button routerLink="/catalog">Retour au catalogue</a>
        </section>
      }
      @if (profile.value(); as p) {
        <header class="leather head">
          <mat-icon>person_pin</mat-icon>
          <h1 class="display">{{ p.nickname }}</h1>
          @if (p.rating; as r) {
            <th-stars [value]="r.stars" [count]="r.count" />
            <span class="small">note d'organisateur donnée par ses joueurs</span>
          } @else {
            <span class="small">n'a pas choisi d'être noté en tant qu'organisateur</span>
          }
        </header>
        <h2 class="section-title">Ses chasses au catalogue</h2>
        @if (p.entries.length) {
          <div class="grid">
            @for (e of p.entries; track e.id) {
              <th-catalog-card [entry]="e" />
            }
          </div>
        } @else {
          <p class="muted center">Aucune chasse publiée pour l'instant.</p>
        }
      }
    </div>
  `,
  styles: `
    .head { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 20px; text-align: center; }
    .head h1 { margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  `,
})
export class OrganizerPage {
  private readonly api = inject(HuntApi);
  readonly id = input.required({ transform: numberAttribute });
  protected readonly profile = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.getOrganizer(params) });
}
