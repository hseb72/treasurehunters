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

/** Bornes du curseur de durée : au-delà de la dernière, pas de limite. */
const DURATION_MIN = 15;
const DURATION_MAX = 360;

/** Catalogue public des chasses (§ 13) : chercher, comparer, puis ouvrir une fiche. */
@Component({
  selector: 'th-catalog',
  imports: [CatalogCard, FormsModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSliderModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss',
})
export class CatalogPage {
  private readonly api = inject(HuntApi);

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

  protected reset(): void {
    this.travel.set([]);
    this.difficulty.set([]);
    this.minDuration.set(DURATION_MIN);
    this.maxDuration.set(DURATION_MAX);
  }
}
