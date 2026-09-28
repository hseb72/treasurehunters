import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import { CatalogEntry } from '@shared/models';
import { distanceLabel } from './distance';
import { LatLng } from './location-map';

/**
 * Carte du catalogue (§ 23) : le départ de chaque chasse, et la position du joueur s'il l'a
 * donnée. Un appui sur un repère ouvre une bulle avec le titre et le lien vers la fiche.
 */
@Component({
  selector: 'th-catalog-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="map" role="region" aria-label="Carte des Secret Tracks du catalogue"></div>`,
  styles: `
    :host { display: block; }
    .map { height: min(65vh, 520px); border-radius: var(--th-radius); border: 1px solid var(--th-border); z-index: 0; }
  `,
})
export class CatalogMap {
  readonly entries = input<CatalogEntry[]>([]);
  readonly me = input<LatLng | null>(null);
  /** Rayon de recherche autour du joueur, en km. */
  readonly radius = input<number | null>(null);

  private readonly router = inject(Router);
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
      this.entries();
      this.me();
      this.radius();
      this.draw();
    });
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private draw(): void {
    const L = this.L;
    if (!L || !this.map || !this.layer) return;
    this.layer.clearLayers();
    const points: [number, number][] = [];
    const icon = L.divIcon({ className: '', html: '<span class="trail-pin trail-pin--start">⚑</span>', iconSize: [28, 28], iconAnchor: [14, 14] });
    for (const e of this.entries()) {
      if (!e.start) continue;
      points.push([e.start.lat, e.start.lng]);
      L.marker([e.start.lat, e.start.lng], { icon, title: e.title }).bindPopup(() => this.popup(e)).addTo(this.layer);
    }
    const me = this.me();
    if (me) {
      points.push([me.lat, me.lng]);
      const radius = this.radius();
      if (radius) {
        L.circle([me.lat, me.lng], { radius: radius * 1000, color: '#1d4ed8', weight: 1, dashArray: '4 6', fillOpacity: 0.05 }).addTo(this.layer);
        const b = L.latLng(me.lat, me.lng).toBounds(radius * 2000);
        points.push([b.getNorth(), b.getEast()], [b.getSouth(), b.getWest()]);
      }
      L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1 }).addTo(this.layer).bindTooltip('Vous êtes ici');
    }
    if (points.length) this.map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
    else this.map.setView([46.6, 2.4], 5);
  }

  /** Bulle d'un repère : construite nœud par nœud (les titres viennent des auteurs). */
  private popup(e: CatalogEntry): HTMLElement {
    const box = document.createElement('div');
    box.className = 'catalog-pop';
    const title = document.createElement('strong');
    title.textContent = e.title;
    const meta = document.createElement('div');
    meta.textContent = [e.location, e.distanceKm !== null ? distanceLabel(e.distanceKm) : null].filter(Boolean).join(' · ');
    const link = document.createElement('a');
    link.href = `/catalog/${e.id}`;
    link.textContent = 'Voir la fiche';
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      void this.router.navigate(['/catalog', e.id]);
    });
    box.append(title, meta, link);
    return box;
  }
}
