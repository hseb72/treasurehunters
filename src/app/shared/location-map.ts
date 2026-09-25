import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, viewChild } from '@angular/core';
import type { CircleMarker, Map as LeafletMap } from 'leaflet';

export interface LatLng {
  lat: number;
  lng: number;
}

/** France métropolitaine, quand aucun point n'est encore choisi. */
const FRANCE: LatLng = { lat: 46.6, lng: 2.4 };

/**
 * Carte OpenStreetMap (Leaflet, chargé à la demande). Un appui pose le repère ;
 * le rayon optionnel montre la zone de jeu autour du point.
 */
@Component({
  selector: 'th-location-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="map" role="application" aria-label="Carte : touchez pour choisir le point de départ"></div>`,
  styles: `
    :host { display: block; }
    .map { height: 280px; border-radius: var(--th-radius); border: 2px solid var(--th-edge); box-shadow: var(--th-shadow); z-index: 0; }
  `,
})
export class LocationMap {
  readonly point = input<LatLng | null>(null);
  /** Rayon de la zone de jeu, en mètres. */
  readonly radius = input<number | null>(null);
  readonly picked = output<LatLng>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private map: LeafletMap | null = null;
  private marker: CircleMarker | null = null;
  private zone: import('leaflet').Circle | null = null;
  private L: typeof import('leaflet') | null = null;

  constructor() {
    afterNextRender(async () => {
      // Leaflet est un module CommonJS : selon l'empaquetage, l'API est l'export par défaut.
      const mod = (await import('leaflet')) as typeof import('leaflet') & { default?: typeof import('leaflet') };
      const L = (this.L = mod.default ?? mod);
      const start = this.point();
      this.map = L.map(this.host().nativeElement, { zoomControl: true }).setView(start ?? FRANCE, start ? 15 : 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this.map);
      this.map.on('click', (e) => this.picked.emit({ lat: e.latlng.lat, lng: e.latlng.lng }));
      this.draw(true);
    });
    effect(() => {
      this.point();
      this.radius();
      this.draw(false);
    });
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private draw(recenter: boolean): void {
    const L = this.L;
    const map = this.map;
    if (!L || !map) return;
    const p = this.point();
    this.marker?.remove();
    this.zone?.remove();
    this.marker = this.zone = null;
    if (!p) return;
    const radius = this.radius();
    if (radius) {
      this.zone = L.circle(p, { radius, color: '#8b5a2b', weight: 1, dashArray: '4 6', fillColor: '#c8962e', fillOpacity: 0.12 }).addTo(map);
    }
    this.marker = L.circleMarker(p, { radius: 9, color: '#3d2413', weight: 3, fillColor: '#9e2b1f', fillOpacity: 0.9 }).addTo(map);
    if (recenter || !map.getBounds().contains(p)) map.setView(p, Math.max(map.getZoom(), 14));
  }
}
