import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { directionsUrl, NEARBY_RADIUS, NearbyPlace, NearbyResult } from '@shared/nearby';
import { Travel } from '@shared/models';
import { HuntApi } from '../core/api';
import { currentPosition } from '../core/geo';
import { LatLng } from './location-map';
import { NearbyMap } from './nearby-map';

/** iPhone et iPad ouvrent Plans d'Apple ; les autres, Google Maps (application ou site). */
const APPLE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;

/**
 * Volet « Autour de moi » (§ 45) : les adresses utiles près du joueur, par catégorie, sur
 * une carte et en liste, avec un itinéraire dans l'application de cartes du téléphone.
 * Rien n'est dévoilé du parcours : la carte est centrée sur le joueur.
 */
@Component({
  selector: 'th-nearby-panel',
  imports: [MatButtonModule, MatIconModule, NearbyMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result(); as r) {
      <div class="chips" role="group" aria-label="Catégories">
        @for (c of r.categories; track c.id) {
          <button type="button" class="chip" [class.on]="category() === c.id" [attr.aria-pressed]="category() === c.id" (click)="choose(c.id)">
            <mat-icon>{{ c.icon }}</mat-icon>{{ c.label }}<span class="count">{{ counts()[c.id] ?? 0 }}</span>
          </button>
        }
      </div>
      <th-nearby-map [me]="me()!" [places]="shown()" [icon]="icon()" [selected]="picked()" (pick)="pick($event)" />
      @if (shown().length) {
        <ul class="places">
          @for (p of shown(); track p.id) {
            <li [id]="'nearby-' + p.id" [class.picked]="picked() === p.id">
              <button type="button" class="place" (click)="pick(p)">
                <strong>{{ p.name ?? p.kind }}</strong>
                <span class="small muted">{{ p.name ? p.kind + ' · ' : '' }}{{ meters(p.distance) }}{{ p.address ? ' · ' + p.address : '' }}</span>
                @if (p.hours) {
                  <span class="small hours"><mat-icon inline>schedule</mat-icon>{{ p.hours }}</span>
                }
              </button>
              <a mat-icon-button [href]="directions(p)" target="_blank" rel="noopener" [attr.aria-label]="'Itinéraire vers ' + (p.name ?? p.kind)">
                <mat-icon>directions_walk</mat-icon>
              </a>
            </li>
          }
        </ul>
      } @else {
        <p class="center muted">Rien de cette catégorie à moins de {{ meters(r.radius) }} d'après OpenStreetMap.</p>
      }
      <div class="sheet-actions">
        <span class="small muted">Données OpenStreetMap : horaires à vérifier sur place.</span>
        <span class="spacer"></span>
        <button mat-button type="button" (click)="load()" [disabled]="busy()"><mat-icon>refresh</mat-icon>Actualiser</button>
      </div>
    } @else if (error(); as e) {
      <p class="center">{{ e }}</p>
      <div class="sheet-actions">
        <span class="spacer"></span>
        <button mat-flat-button type="button" (click)="load()" [disabled]="busy()"><mat-icon>refresh</mat-icon>Réessayer</button>
      </div>
    } @else {
      <p class="center muted">Recherche des adresses autour de vous…</p>
    }
  `,
  styles: `
    .chips { display: flex; gap: 6px; overflow-x: auto; padding: 8px 0 10px; scrollbar-width: none; }
    .chip {
      display: inline-flex; align-items: center; gap: 4px; flex: none; padding: 6px 10px;
      border: 1px solid var(--th-border); border-radius: 999px; background: var(--th-surface);
      font: 600 0.8rem var(--th-font-body); color: inherit; cursor: pointer;
      mat-icon { width: 18px; height: 18px; font-size: 18px; }
      &.on { border-color: var(--th-primary); background: color-mix(in srgb, var(--th-primary) 14%, transparent); }
    }
    .count { margin-left: 2px; font-weight: 400; opacity: 0.7; }
    .places { list-style: none; margin: 10px 0 0; padding: 0; }
    li { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--th-border); }
    li.picked { background: color-mix(in srgb, var(--th-primary) 10%, transparent); }
    .place {
      display: flex; flex: 1; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 4px;
      border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
    }
    .hours { display: inline-flex; align-items: center; gap: 4px; }
  `,
})
export class NearbyPanel {
  private readonly api = inject(HuntApi);

  readonly travel = input<Travel>('walk');
  /** Partie en cours : les centres d'intérêt de l'équipe (§ 46) passent en tête. */
  readonly huntId = input<number | undefined>();

  protected readonly me = signal<LatLng | null>(null);
  protected readonly result = signal<NearbyResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly category = signal<string>('snack');
  protected readonly picked = signal<string | null>(null);

  protected readonly counts = computed(() => {
    const n: Record<string, number> = {};
    for (const p of this.result()?.places ?? []) n[p.category] = (n[p.category] ?? 0) + 1;
    return n;
  });
  protected readonly shown = computed(() => (this.result()?.places ?? []).filter((p) => p.category === this.category()));
  protected readonly icon = computed(() => this.result()?.categories.find((c) => c.id === this.category())?.icon ?? 'place');

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const p = await currentPosition();
      this.me.set({ lat: p.lat, lng: p.lng });
      this.api.nearby({ lat: p.lat, lng: p.lng }, NEARBY_RADIUS[this.travel()], this.huntId()).subscribe({
        next: (r) => {
          this.result.set(r);
          // Le premier centre d'intérêt de l'équipe ; sinon la catégorie en cours si elle a des
          // adresses, ou la première qui en a.
          const interest = r.categories.find((c) => c.id.startsWith('interest-'));
          const filled = r.categories.find((c) => r.places.some((p) => p.category === c.id));
          if (interest) this.category.set(interest.id);
          else if (filled && !r.places.some((p) => p.category === this.category())) this.category.set(filled.id);
          this.busy.set(false);
        },
        error: (e) => {
          this.error.set(e instanceof Error ? e.message : 'Les adresses ne sont pas disponibles pour le moment.');
          this.busy.set(false);
        },
      });
    } catch (e) {
      this.error.set((e as Error).message);
      this.busy.set(false);
    }
  }

  protected choose(id: string): void {
    this.category.set(id);
    this.picked.set(null);
  }

  protected pick(p: NearbyPlace): void {
    this.picked.set(p.id);
    document.getElementById(`nearby-${p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  protected directions(p: NearbyPlace): string {
    return directionsUrl(p, APPLE);
  }

  protected meters(m: number): string {
    return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
  }
}
