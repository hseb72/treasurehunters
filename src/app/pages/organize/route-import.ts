import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { concat, last, Observable } from 'rxjs';
import { Step } from '@shared/models';
import { ImportResult, parseGpx, parsePlaceList } from '@shared/route-import';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';

/**
 * Import d'un parcours (§ 31) : une liste de lieux collée ou un fichier GPX devient une suite
 * d'étapes, insérées avant l'arrivée. Le premier lieu peut devenir le départ, le dernier l'arrivée.
 */
@Component({
  selector: 'th-route-import',
  imports: [FormsModule, MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <mat-icon>upload_file</mat-icon>
      <strong>Importer un parcours</strong>
      <span class="spacer"></span>
      <button mat-icon-button type="button" (click)="closed.emit()" aria-label="Fermer"><mat-icon>close</mat-icon></button>
    </div>
    <mat-button-toggle-group [value]="source()" (change)="setSource($event.value)" hideSingleSelectionIndicator aria-label="Source">
      <mat-button-toggle value="list"><mat-icon>list</mat-icon> Liste de lieux</mat-button-toggle>
      <mat-button-toggle value="gpx"><mat-icon>route</mat-icon> Fichier GPX</mat-button-toggle>
    </mat-button-toggle-group>

    @if (source() === 'list') {
      <mat-form-field class="field-full" subscriptSizing="dynamic">
        <mat-label>Un lieu par ligne</mat-label>
        <textarea matInput rows="6" [ngModel]="text()" (ngModelChange)="text.set($event)"
          placeholder="Place de la Comédie ; 43.6085, 3.8797&#10;Promenade du Peyrou&#10;https://www.google.com/maps/@43.6147,3.8723,17z Jardin des plantes"></textarea>
      </mat-form-field>
      <p class="small muted">Nom du lieu, et si vous l'avez sa position (latitude, longitude) ou un lien de carte. Sans position, l'étape reste à placer sur la carte.</p>
    } @else {
      <input #file type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden (change)="readFile(file)" />
      <div class="row">
        <button mat-stroked-button type="button" (click)="file.click()"><mat-icon>folder_open</mat-icon>Choisir un fichier GPX</button>
        @if (fileName(); as f) {
          <span class="small muted">{{ f }}</span>
        }
      </div>
      <p class="small muted">Les points de passage du fichier (ou les points de l'itinéraire) deviennent les étapes, dans l'ordre.</p>
    }

    @if (result(); as r) {
      @for (p of r.problems; track $index) {
        <p class="small warn"><mat-icon inline>info</mat-icon> {{ p }}</p>
      }
      @if (r.places.length) {
        <ol class="preview">
          @for (p of r.places; track $index; let i = $index) {
            <li>
              <span class="tag">{{ role(i, r.places.length) }}</span>
              <span>{{ p.title }}</span>
              @if (p.lat === null) {
                <span class="small unplaced"><mat-icon inline>wrong_location</mat-icon> à placer</span>
              }
            </li>
          }
        </ol>
        <mat-checkbox [ngModel]="asStart()" (ngModelChange)="asStart.set($event)">Le premier lieu est le départ</mat-checkbox>
        <mat-checkbox [ngModel]="asEnd()" (ngModelChange)="asEnd.set($event)" [disabled]="r.places.length < 2 && asStart()">Le dernier lieu est l'arrivée (le trésor)</mat-checkbox>
        <div class="row end">
          <button mat-flat-button type="button" (click)="create(r)" [disabled]="busy()">
            <mat-icon>{{ busy() ? 'hourglass_top' : 'add_location_alt' }}</mat-icon>Créer {{ newCount() }} étape{{ newCount() > 1 ? 's' : '' }}
          </button>
        </div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; }
    .head, .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .head mat-icon { color: var(--th-primary); }
    .spacer { flex: 1; }
    .end { justify-content: flex-end; }
    p { margin: 0; }
    .warn { color: var(--th-accent); }
    .preview { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow: auto; }
    .preview li { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
    .tag { font-size: 0.75rem; font-weight: 700; color: var(--th-primary); min-width: 64px; }
    .unplaced { color: var(--th-accent); }
  `,
})
export class RouteImport {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);

  readonly huntId = input.required<number>();
  readonly steps = input.required<Step[]>();
  readonly imported = output<void>();
  readonly closed = output<void>();

  protected readonly source = signal<'list' | 'gpx'>('list');
  protected readonly text = signal('');
  protected readonly gpx = signal<ImportResult | null>(null);
  protected readonly fileName = signal<string | null>(null);
  protected readonly asStart = signal(false);
  protected readonly asEnd = signal(false);
  protected readonly busy = signal(false);

  protected readonly result = computed<ImportResult | null>(() => {
    if (this.source() === 'gpx') return this.gpx();
    return this.text().trim() ? parsePlaceList(this.text()) : null;
  });
  /** Étapes créées (les lieux pris pour le départ ou l'arrivée modifient les étapes existantes). */
  protected readonly newCount = computed(() => {
    const n = this.result()?.places.length ?? 0;
    return Math.max(0, n - (this.asStart() ? 1 : 0) - (this.asEnd() && n > (this.asStart() ? 1 : 0) ? 1 : 0));
  });

  protected role(i: number, n: number): string {
    if (i === 0 && this.asStart()) return 'Départ';
    if (i === n - 1 && this.asEnd() && !(i === 0 && this.asStart())) return 'Arrivée';
    return 'Étape';
  }

  protected setSource(s: 'list' | 'gpx'): void {
    this.source.set(s);
  }

  protected async readFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 5_000_000) {
      this.notify.error(new Error('Fichier trop lourd (5 Mo au plus).'));
      return;
    }
    this.fileName.set(file.name);
    this.gpx.set(parseGpx(await file.text()));
  }

  protected create(r: ImportResult): void {
    const places = [...r.places];
    const steps = [...this.steps()].sort((a, b) => a.order - b.order);
    const start = steps[0];
    const arrival = steps.length > 1 ? steps[steps.length - 1] : undefined;
    const calls: Observable<Step>[] = [];
    const fields = (p: (typeof places)[number]) => ({ title: p.title, latitude: p.lat, longitude: p.lng });
    if (this.asStart() && start && places.length) calls.push(this.api.saveStep({ id: start.id, huntId: this.huntId(), ...fields(places.shift()!) }));
    const end = this.asEnd() && arrival && places.length ? places.pop()! : null;
    for (const p of places) calls.push(this.api.saveStep({ huntId: this.huntId(), ...fields(p) }));
    if (end && arrival) calls.push(this.api.saveStep({ id: arrival.id, huntId: this.huntId(), ...fields(end) }));
    if (!calls.length) return;
    this.busy.set(true);
    concat(...calls)
      .pipe(last())
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.notify.info('Parcours importé : relisez chaque étape et rédigez ses énigmes.');
          this.text.set('');
          this.gpx.set(null);
          this.fileName.set(null);
          this.imported.emit();
        },
        error: (e) => {
          this.busy.set(false);
          this.notify.error(e);
          this.imported.emit();
        },
      });
  }
}
