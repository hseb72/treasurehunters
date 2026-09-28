import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, viewChild } from '@angular/core';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import { PlayState } from '@shared/models';
import { LatLng } from './location-map';

/**
 * Outil Carte du carnet de route : le départ, les lieux déjà trouvés (numérotés) et la
 * position de l'équipe si elle l'a demandée. Jamais le prochain lieu.
 */
@Component({
  selector: 'th-trail-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="map" role="img" aria-label="Carte du parcours accompli"></div>`,
  styles: `
    :host { display: block; }
    .map { height: min(60vh, 420px); border-radius: var(--th-radius); border: 1px solid var(--th-border); z-index: 0; }
  `,
})
export class TrailMap {
  readonly start = input<PlayState['start']>(null);
  readonly trail = input<NonNullable<PlayState['trail']>>([]);
  readonly me = input<LatLng | null>(null);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private map: LeafletMap | null = null;
  private layer: LayerGroup | null = null;
  private L: typeof import('leaflet') | null = null;

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
      this.start();
      this.trail();
      this.me();
      this.draw();
    });
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private draw(): void {
    const L = this.L;
    if (!L || !this.map || !this.layer) return;
    this.layer.clearLayers();
    const points: [number, number][] = [];
    const start = this.start();
    const pin = (text: string, cls: string) => L.divIcon({ className: '', html: `<span class="trail-pin ${cls}">${text}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
    if (start) {
      points.push([start.lat, start.lng]);
      L.marker([start.lat, start.lng], { icon: pin('⚑', 'trail-pin--start'), title: start.name ?? 'Départ' }).addTo(this.layer);
    }
    for (const p of this.trail()) {
      points.push([p.lat, p.lng]);
      L.marker([p.lat, p.lng], { icon: pin(String(p.order), ''), title: p.title }).addTo(this.layer);
    }
    if (points.length > 1) L.polyline(points, { color: '#e4572e', weight: 3, dashArray: '6 8' }).addTo(this.layer);
    const me = this.me();
    if (me) {
      points.push([me.lat, me.lng]);
      L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1 }).addTo(this.layer).bindTooltip('Vous êtes ici');
    }
    if (points.length) this.map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 17 });
    else this.map.setView([46.6, 2.4], 5);
  }
}
