import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, viewChild } from '@angular/core';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';

/** Étape placée sur la carte de l'organisateur. */
export interface RoutePoint {
  id: number;
  order: number;
  title: string;
  lat: number;
  lng: number;
  /** Autres points d'où l'étape se valide (entrées d'un parc, d'un musée…). */
  entrances: { lat: number; lng: number }[];
}

/**
 * Carte du parcours pour l'organisateur (§ 8) : chaque étape numérotée, le départ (⚑) et
 * l'arrivée (★), reliés dans l'ordre, plus le retour de l'arrivée au départ en pointillés.
 * Un appui sur un repère choisit l'étape.
 */
@Component({
  selector: 'th-route-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="map" role="img" aria-label="Carte du parcours : étapes numérotées dans l'ordre"></div>`,
  styles: `
    :host { display: block; }
    .map { height: min(65vh, 520px); border-radius: var(--th-radius); border: 1px solid var(--th-border); z-index: 0; }
  `,
})
export class RouteMap {
  readonly points = input<RoutePoint[]>([]);
  /** Ordre de l'arrivée (dernière étape du parcours). */
  readonly finalOrder = input(0);
  readonly selected = input<number | null>(null);
  readonly pick = output<RoutePoint>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private map: LeafletMap | null = null;
  private layer: LayerGroup | null = null;
  private L: typeof import('leaflet') | null = null;
  private fitted = '';

  constructor() {
    afterNextRender(async () => {
      // Leaflet est un module CommonJS : selon l'empaquetage, l'API est l'export par défaut.
      const mod = (await import('leaflet')) as typeof import('leaflet') & { default?: typeof import('leaflet') };
      const L = (this.L = mod.default ?? mod);
      this.map = L.map(this.host().nativeElement, { zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
      this.draw();
    });
    effect(() => {
      this.points();
      this.finalOrder();
      this.selected();
      this.draw();
    });
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private draw(): void {
    const L = this.L;
    if (!L || !this.map || !this.layer) return;
    this.layer.clearLayers();
    const points = [...this.points()].sort((a, b) => a.order - b.order);
    const final = this.finalOrder();
    const pin = (text: string, cls: string) =>
      L.divIcon({ className: '', html: `<span class="trail-pin ${cls}">${text}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });

    const line = points.map((p) => [p.lat, p.lng] as [number, number]);
    if (line.length > 1) L.polyline(line, { color: '#e4572e', weight: 3 }).addTo(this.layer);
    // Retour de l'arrivée au départ : ce que les joueurs marcheront sans énigme.
    const start = points.find((p) => p.order === 0);
    const end = points.find((p) => p.order === final && final > 0);
    if (start && end) {
      L.polyline(
        [
          [end.lat, end.lng],
          [start.lat, start.lng],
        ],
        { color: '#64748b', weight: 2, dashArray: '4 8' },
      )
        .addTo(this.layer)
        .bindTooltip('Retour au départ', { sticky: true });
    }

    for (const p of points) {
      for (const e of p.entrances) {
        L.circleMarker([e.lat, e.lng], { radius: 4, color: '#64748b', weight: 1, fillColor: '#fff', fillOpacity: 1 })
          .addTo(this.layer)
          .bindTooltip(`Autre entrée de l'étape ${p.order}`);
      }
      const isStart = p.order === 0;
      const isEnd = p.order === final && final > 0;
      const cls = [isStart ? 'trail-pin--start' : isEnd ? 'trail-pin--end' : '', this.selected() === p.id ? 'trail-pin--selected' : ''].join(' ');
      const marker = L.marker([p.lat, p.lng], {
        icon: pin(isStart ? '⚑' : isEnd ? '★' : String(p.order), cls),
        title: `${isStart ? 'Départ' : isEnd ? 'Arrivée' : 'Étape ' + p.order} : ${p.title}`,
        zIndexOffset: this.selected() === p.id ? 1000 : 0,
      }).addTo(this.layer);
      marker.on('click', () => this.pick.emit(p));
    }

    // Recadre seulement quand l'ensemble des points change, pas à chaque sélection.
    const key = line.map((l) => l.join(',')).join(';');
    if (key === this.fitted) return;
    this.fitted = key;
    if (line.length) this.map.fitBounds(L.latLngBounds(line), { padding: [30, 30], maxZoom: 17 });
    else this.map.setView([46.6, 2.4], 5);
  }
}
