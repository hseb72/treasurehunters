import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSliderModule } from '@angular/material/slider';
import { debounceTime } from 'rxjs';
import { DIFFICULTY_LABELS, minutesLabel, TRAVEL_ICONS, TRAVEL_MEANS } from '@shared/generation';
import { Difficulty, Travel } from '@shared/models';
import { CatalogQuery, HuntApi } from '../../core/api';
import { CatalogCard } from '../../shared/catalog-card';
import { CatalogMap } from '../../shared/catalog-map';
import { currentPosition } from '../../core/geo';
import { Notify } from '../../core/notify';

/** Rayons proposés autour du joueur, en km (0 = partout, triées par distance). */
const RADII = [2, 5, 10, 30, 0];

/** Bornes du curseur de durée : au-delà de la dernière, pas de limite. */
const DURATION_MIN = 15;
const DURATION_MAX = 360;

/** Catalogue public des chasses (§ 13) : chercher, comparer, puis ouvrir une fiche. */
@Component({
  selector: 'th-catalog',
  imports: [CatalogCard, CatalogMap, FormsModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSliderModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss',
})
export class CatalogPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);

  /** « ?jouer=1 » : ouvrir sur les chasses jouables en autonomie (§ 13.5). */
  readonly jouer = input<string | undefined>();
  protected readonly autonomous = linkedSignal(() => this.jouer() === '1');
  protected readonly query = signal('');
  protected readonly sort = signal<NonNullable<CatalogQuery['sort']>>('rating');
  protected readonly travel = signal<Travel[]>([]);
  protected readonly difficulty = signal<Difficulty[]>([]);
  protected readonly minDuration = signal(DURATION_MIN);
  protected readonly maxDuration = signal(DURATION_MAX);
  protected readonly durationBounds = { min: DURATION_MIN, max: DURATION_MAX };
  /** Près de moi (§ 23) : position du joueur, rayon de recherche (0 = partout) et affichage. */
  protected readonly near = signal<{ lat: number; lng: number } | null>(null);
  protected readonly locating = signal(false);
  protected readonly radius = signal(5);
  protected readonly radii = RADII;
  protected readonly view = signal<'list' | 'map'>('list');

  protected readonly travels = (Object.keys(TRAVEL_MEANS) as Travel[]).map((t) => ({ value: t, label: TRAVEL_MEANS[t], icon: TRAVEL_ICONS[t] }));
  protected readonly difficulties = Object.entries(DIFFICULTY_LABELS) as [Difficulty, string][];

  private readonly debounced = toSignal(toObservable(this.query).pipe(debounceTime(300)), { initialValue: '' });
  /** Le curseur de durée ne relance la recherche qu'une fois lâché. */
  private readonly duration = toSignal(
    toObservable(computed(() => [this.minDuration(), this.maxDuration()] as const)).pipe(debounceTime(250)),
    { initialValue: [DURATION_MIN, DURATION_MAX] as const },
  );

  protected readonly filtered = computed(
    () => this.travel().length > 0 || this.difficulty().length > 0 || this.minDuration() > DURATION_MIN || this.maxDuration() < DURATION_MAX,
  );

  protected readonly entries = rxResource({
    params: (): CatalogQuery => {
      const [min, max] = this.duration();
      return {
        q: this.debounced(),
        sort: this.sort(),
        autonomous: this.autonomous() || undefined,
        near: this.near() ?? undefined,
        radius: this.near() && this.radius() ? this.radius() : undefined,
        travel: this.travel(),
        difficulty: this.difficulty(),
        minDuration: min > DURATION_MIN ? min : undefined,
        maxDuration: max < DURATION_MAX ? max : undefined,
      };
    },
    stream: ({ params }) => this.api.listCatalog(params),
    defaultValue: [],
  });

  protected durationLabel = (minutes: number): string => (minutes >= DURATION_MAX ? '6 h +' : minutesLabel(minutes));

  protected readonly durationText = computed(() => {
    const min = this.minDuration();
    const max = this.maxDuration();
    if (min <= DURATION_MIN && max >= DURATION_MAX) return 'Toutes durées';
    if (min <= DURATION_MIN) return `Jusqu'à ${minutesLabel(max)}`;
    if (max >= DURATION_MAX) return `Au moins ${minutesLabel(min)}`;
    return `De ${minutesLabel(min)} à ${minutesLabel(max)}`;
  });

  /** Demande la position du téléphone, puis trie les chasses par distance au départ. */
  protected async locate(): Promise<void> {
    this.locating.set(true);
    try {
      const p = await currentPosition();
      this.near.set({ lat: p.lat, lng: p.lng });
      this.sort.set('distance');
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.locating.set(false);
    }
  }

  protected forget(): void {
    this.near.set(null);
    if (this.sort() === 'distance') this.sort.set('rating');
  }

  protected radiusLabel = (km: number): string => (km ? `${km} km` : 'Partout');

  /** Rayon suivant, pour élargir une recherche sans résultat. */
  protected readonly wider = computed(() => {
    const r = this.radius();
    return r ? (RADII.find((x) => x > r) ?? 0) : null;
  });

  protected reset(): void {
    this.travel.set([]);
    this.difficulty.set([]);
    this.minDuration.set(DURATION_MIN);
    this.maxDuration.set(DURATION_MAX);
  }
}
