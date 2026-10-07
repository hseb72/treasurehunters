import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, viewChild } from '@angular/core';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import { NearbyPlace } from '@shared/nearby';
import { LatLng } from './location-map';

/**
 * Carte « Autour de moi » (§ 45) : le joueur au centre et les adresses de la catégorie
 * choisie, avec leur icône. Un appui sur un repère choisit l'adresse.
 */
@Component({
  selector: 'th-nearby-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="map" role="img" aria-label="Carte des adresses autour de vous"></div>`,
  styles: `
    :host { display: block; }
    .map { height: min(38vh, 320px); border-radius: var(--th-radius); border: 1px solid var(--th-border); z-index: 0; }
  `,
})
export class NearbyMap {
  readonly me = input.required<LatLng>();
  readonly places = input<NearbyPlace[]>([]);
  /** Icône Material Symbols de la catégorie affichée. */
  readonly icon = input('place');
  readonly selected = input<string | null>(null);
  readonly pick = output<NearbyPlace>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private map: LeafletMap | null = null;
  private layer: LayerGroup | null = null;
  private L: typeof import('leaflet') | null = null;
  private fitted = '';

  constructor() {
    afterNextRender(async () => {
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
      this.me();
      this.places();
      this.icon();
      this.selected();
      this.draw();
    });
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private draw(): void {
    const L = this.L;
    if (!L || !this.map || !this.layer) return;
    this.layer.clearLayers();
    const me = this.me();
    const icon = this.icon().replace(/[^a-z_]/g, '');
    for (const p of this.places()) {
      const selected = this.selected() === p.id;
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: '',
          html: `<span class="trail-pin nearby-pin${selected ? ' trail-pin--selected' : ''}"><span class="material-symbols-outlined">${icon}</span></span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: p.name ?? p.kind,
        zIndexOffset: selected ? 1000 : 0,
      }).addTo(this.layer);
      marker.on('click', () => this.pick.emit(p));
    }
    L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1 }).addTo(this.layer).bindTooltip('Vous êtes ici');

    // Recadre quand la catégorie change, pas à chaque sélection.
    const points: [number, number][] = [[me.lat, me.lng], ...this.places().map((p) => [p.lat, p.lng] as [number, number])];
    const key = points.map((x) => x.join(',')).join(';');
    if (key === this.fitted) return;
    this.fitted = key;
    if (points.length > 1) this.map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 17 });
    else this.map.setView([me.lat, me.lng], 16);
  }
}
