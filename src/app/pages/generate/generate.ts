import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSliderModule } from '@angular/material/slider';
import { Router, RouterLink } from '@angular/router';
import { Subscription, switchMap, takeWhile, timer } from 'rxjs';
import { DIFFICULTY_LABELS, plannedStepCount, searchRadius } from '@shared/generation';
import { Difficulty, GenerationJob, GenerationRequest } from '@shared/models';
import { HuntApi } from '../../core/api';
import { currentPosition } from '../../core/geo';
import { Notify } from '../../core/notify';
import { CompassLogo } from '../../shared/compass-logo';
import { LatLng, LocationMap } from '../../shared/location-map';

type Where = 'city' | 'map' | 'me';

const POLL_MS = 2500;
/** Messages d'attente, affichés tour à tour pendant la génération. */
const WAIT_LINES = [
  'On déroule la carte…',
  'On repère les lieux remarquables du coin…',
  'Le maître du jeu trace le parcours…',
  'On rédige les énigmes à la plume…',
  'On scelle les jokers à la cire…',
  'On cache le trésor…',
];

@Component({
  selector: 'th-generate',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSliderModule,
    RouterLink,
    CompassLogo,
    LocationMap,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './generate.html',
  styleUrl: './generate.scss',
})
export class GeneratePage {
  private readonly api = inject(HuntApi);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);

  /** Génération en cours (dans l'URL pour survivre à un rechargement). */
  readonly job = input<string | undefined>();

  protected readonly where = signal<Where>('city');
  protected readonly query = signal('');
  protected readonly point = signal<LatLng | null>(null);
  protected readonly locating = signal(false);
  protected readonly duration = signal(60);
  protected readonly difficulty = signal<Difficulty>('medium');
  protected readonly autoSteps = signal(true);
  protected readonly steps = signal(5);
  protected readonly mode = signal<GenerationRequest['mode']>('play');

  protected readonly difficulties = Object.entries(DIFFICULTY_LABELS) as [Difficulty, string][];
  protected readonly radius = computed(() => searchRadius(this.duration()));
  protected readonly stepCount = computed(() =>
    plannedStepCount({ steps: this.autoSteps() ? null : this.steps(), durationMinutes: this.duration(), difficulty: this.difficulty() }),
  );
  protected readonly ready = computed(() => (this.where() === 'city' ? this.query().trim().length > 1 : this.point() !== null));

  protected readonly status = signal<GenerationJob | null>(null);
  protected readonly waitLine = signal(WAIT_LINES[0]);
  private polling: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.polling?.unsubscribe());
    queueMicrotask(() => {
      const id = this.job();
      if (id) this.follow(id);
    });
  }

  protected durationLabel(minutes: number): string {
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`;
  }

  protected async locate(): Promise<void> {
    this.where.set('me');
    this.locating.set(true);
    try {
      const p = await currentPosition();
      this.point.set({ lat: p.lat, lng: p.lng });
    } catch (e) {
      this.notify.error(e);
      this.where.set('map');
    } finally {
      this.locating.set(false);
    }
  }

  protected submit(): void {
    if (!this.ready()) return;
    const p = this.point();
    const request: GenerationRequest = {
      location: this.where() === 'city' ? { query: this.query().trim() } : { lat: p!.lat, lng: p!.lng },
      durationMinutes: this.duration(),
      difficulty: this.difficulty(),
      steps: this.autoSteps() ? null : this.steps(),
      mode: this.mode(),
    };
    this.api.generateHunt(request).subscribe({
      next: (job) => {
        this.router.navigate([], { queryParams: { job: job.id }, replaceUrl: true });
        this.follow(job.id);
      },
      error: (e) => this.notify.error(e),
    });
  }

  protected retry(): void {
    this.polling?.unsubscribe();
    this.status.set(null);
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  private follow(id: string): void {
    this.polling?.unsubscribe();
    this.status.set({ id, status: 'pending', mode: this.mode(), huntId: null, error: null });
    let tick = 0;
    this.polling = timer(0, POLL_MS)
      .pipe(
        switchMap(() => {
          this.waitLine.set(WAIT_LINES[Math.min(tick++ >> 1, WAIT_LINES.length - 1)]);
          return this.api.getGeneration(id);
        }),
        takeWhile((job) => job.status === 'pending', true),
      )
      .subscribe({
        next: (job) => {
          this.status.set(job);
          if (job.status === 'done' && job.huntId) {
            // « Je joue » : direction le carnet de route, sans rien dévoiler. « J'organise » : l'éditeur d'étapes.
            this.router.navigate(job.mode === 'play' ? ['/play', job.huntId] : ['/organize', job.huntId, 'steps'], { replaceUrl: true });
          }
        },
        error: (e) => {
          this.status.set({ id, status: 'error', mode: this.mode(), huntId: null, error: (e as Error).message });
        },
      });
  }
}
