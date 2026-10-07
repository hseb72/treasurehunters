import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { LOOP_MAX_METERS, TRAVEL_LABELS } from '@shared/generation';
import { distanceMeters, routeKm } from '@shared/rules';
import { HuntApi } from '../../core/api';
import { RouteMap, RoutePoint } from '../../shared/route-map';
import { WorkspaceState } from './workspace-state';

/**
 * Onglet « Carte » de l'organisateur : le parcours créé ou généré sur une carte, étapes
 * numérotées dans l'ordre, longueur du parcours et retour de l'arrivée au départ.
 */
@Component({
  selector: 'th-route-map-page',
  imports: [DecimalPipe, MatButtonModule, MatIconModule, RouterLink, RouteMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (steps.value(); as all) {
      <section class="summary surface">
        <div><strong>{{ points().length }}/{{ all.length }}</strong><span class="small muted">lieux placés</span></div>
        <div>
          <strong>{{ km() === null ? '—' : (km()! | number: '1.0-1' : 'fr') + ' km' }}</strong>
          <span class="small muted">de parcours (vol d'oiseau)</span>
        </div>
        <div [class.warn]="returnTooFar()">
          <strong>{{ back() === null ? '—' : back()! < 1000 ? back() + ' m' : (back()! / 1000 | number: '1.0-1' : 'fr') + ' km' }}</strong>
          <span class="small muted">retour arrivée → départ</span>
        </div>
      </section>

      @if (returnTooFar()) {
        <p class="note warn-note small">
          <mat-icon inline>warning</mat-icon>
          L'arrivée est loin du départ pour une {{ travelLabel() }} (moins de {{ loopMax() }} m conseillés) : les joueurs venus en voiture ou en
          transports devront refaire ce trajet sans énigme.
        </p>
      }

      <th-route-map [points]="points()" [finalOrder]="finalOrder()" [selected]="selected()?.id ?? null" (pick)="selected.set($event)" />

      @if (selected(); as p) {
        <section class="surface picked" aria-live="polite">
          <span class="pin" [class.pin--start]="p.order === 0" [class.pin--end]="p.order === finalOrder()">
            {{ p.order === 0 ? '⚑' : p.order === finalOrder() ? '★' : p.order }}
          </span>
          <div class="grow">
            <strong>{{ p.title }}</strong>
            <span class="small muted">{{ p.order === 0 ? 'Départ' : p.order === finalOrder() ? 'Arrivée' : 'Étape ' + p.order }}{{ p.entrances.length ? ' · ' + (p.entrances.length + 1) + ' entrées' : '' }}</span>
          </div>
          <a mat-stroked-button [routerLink]="['../steps']" [queryParams]="{ step: p.id }"><mat-icon>edit</mat-icon>Modifier</a>
        </section>
      } @else if (points().length) {
        <p class="small muted center">Touchez un repère pour voir l'étape.</p>
      }

      @if (unplaced().length) {
        <section class="surface">
          <h3 class="small">À placer sur la carte</h3>
          <ul class="unplaced">
            @for (s of unplaced(); track s.id) {
              <li>
                <span>{{ s.order === 0 ? 'Départ' : s.order === finalOrder() ? 'Arrivée' : 'Étape ' + s.order }} · {{ s.title }}</span>
                <a mat-button [routerLink]="['../steps']" [queryParams]="{ step: s.id }">Placer</a>
              </li>
            }
          </ul>
        </section>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; }
    .summary div { display: flex; flex-direction: column; }
    .summary strong { font-size: 1.25rem; color: var(--th-primary); }
    .summary .warn strong { color: var(--th-brick, #b91c1c); }
    .warn-note { display: flex; gap: 6px; align-items: flex-start; margin: 0; color: var(--th-brick, #b91c1c); }
    .picked { display: flex; align-items: center; gap: 10px; }
    .picked .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .pin { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 50%; background: #13294b; color: #fff; font-weight: 700; }
    .pin--start { background: #e4572e; }
    .pin--end { background: #b45309; }
    .center { text-align: center; margin: 0; }
    h3 { margin: 0 0 4px; }
    .unplaced { margin: 0; padding: 0; list-style: none; }
    .unplaced li { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  `,
})
export class RouteMapPage {
  private readonly api = inject(HuntApi);
  private readonly workspace = inject(WorkspaceState);

  protected readonly steps = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.getSteps(params),
  });

  protected readonly selected = signal<RoutePoint | null>(null);

  protected readonly finalOrder = computed(() => (this.steps.value() ?? []).reduce((m, s) => Math.max(m, s.order), 0));

  protected readonly points = computed<RoutePoint[]>(() =>
    (this.steps.value() ?? [])
      .filter((s) => s.latitude !== null && s.longitude !== null)
      .map((s) => ({ id: s.id, order: s.order, title: s.title, lat: Number(s.latitude), lng: Number(s.longitude), entrances: s.entrances ?? [] }))
      .sort((a, b) => a.order - b.order),
  );

  protected readonly unplaced = computed(() => (this.steps.value() ?? []).filter((s) => s.latitude === null || s.longitude === null));

  protected readonly km = computed(() => routeKm(this.points()));

  /** Distance de l'arrivée au départ, en mètres (null si l'un des deux n'est pas placé). */
  protected readonly back = computed(() => {
    const start = this.points().find((p) => p.order === 0);
    const end = this.points().find((p) => p.order === this.finalOrder() && p.order > 0);
    return start && end ? Math.round(distanceMeters(start, end)) : null;
  });

  private readonly travel = computed(() => this.workspace.hunt.value()?.travel ?? 'walk');
  protected readonly travelLabel = computed(() => TRAVEL_LABELS[this.travel()]);
  protected readonly loopMax = computed(() => LOOP_MAX_METERS[this.travel()]);
  protected readonly returnTooFar = computed(() => (this.back() ?? 0) > this.loopMax());
}
