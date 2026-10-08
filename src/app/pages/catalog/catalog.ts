import { ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
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
import { AUDIENCE_TAGS, AudienceTag, PRACTICAL_TAGS, PracticalTag, Setting, SETTINGS } from '@shared/practical';
import { CatalogQuery, HuntApi } from '../../core/api';
import { CatalogCard } from '../../shared/catalog-card';
import { CatalogMap } from '../../shared/catalog-map';
import { currentPosition } from '../../core/geo';
import { Notify } from '../../core/notify';
import { DomTranslator } from '../../core/dom-translator';
import { SurpriseMe } from '../../shared/surprise-dialog';

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
  /** Surprends-moi (§ 37). */
  protected readonly surpriseMe = inject(SurpriseMe);
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);

  /** « ?jouer=1 » : ouvrir sur les chasses jouables en autonomie (§ 13.5). */
  readonly jouer = input<string | undefined>();
  protected readonly autonomous = linkedSignal(() => this.jouer() === '1');
  protected readonly query = signal('');
  protected readonly sort = signal<NonNullable<CatalogQuery['sort']>>('rating');
  protected readonly travel = signal<Travel[]>([]);
  protected readonly difficulty = signal<Difficulty[]>([]);
  /** Repères pratiques exigés (§ 26). */
  protected readonly practical = signal<PracticalTag[]>([]);
  protected readonly practicalTags = PRACTICAL_TAGS;
  /** Je cherche une Secret Track… (§ 36) : avec qui, où, prix, longueur. */
  protected readonly audience = signal<AudienceTag[]>([]);
  protected readonly audienceTags = AUDIENCE_TAGS;
  protected readonly setting = signal<Setting[]>([]);
  protected readonly settings = SETTINGS;
  protected readonly price = signal<'free' | 'paid' | null>(null);
  protected readonly maxKm = signal<number | null>(null);
  protected readonly kms = [3, 5, 10];
  /** Sessions organisées (§ 40) : aujourd'hui, ou cette semaine. */
  protected readonly session = signal<'today' | 'week' | null>(null);
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

  /** « ?criteres=1 » : ouvrir directement les critères avancés (lien « Plus de critères » de l'accueil). */
  readonly criteres = input<string | undefined>();
  /** Critères avancés : masqués par défaut, ouverts par « Plus de critères ». */
  protected readonly moreOpen = linkedSignal(() => this.criteres() === '1');
  /** Nombre de critères avancés en vigueur, rappelé sur le bouton quand la section est fermée. */
  protected readonly activeCriteria = computed(
    () =>
      [
        this.travel().length > 0,
        this.difficulty().length > 0,
        this.practical().length > 0,
        this.audience().length > 0,
        this.setting().length > 0,
        this.price() !== null,
        this.maxKm() !== null,
        this.session() !== null,
        this.minDuration() > DURATION_MIN || this.maxDuration() < DURATION_MAX,
      ].filter(Boolean).length,
  );

  protected readonly filtered = computed(
    () =>
      this.travel().length > 0 ||
      this.difficulty().length > 0 ||
      this.practical().length > 0 ||
      this.audience().length > 0 ||
      this.setting().length > 0 ||
      this.price() !== null ||
      this.maxKm() !== null ||
      this.session() !== null ||
      this.minDuration() > DURATION_MIN ||
      this.maxDuration() < DURATION_MAX,
  );

  /** Raccourcis « Je cherche une Secret Track… » : chacun règle (ou défait) quelques critères. */
  protected readonly presets: { id: string; label: string; icon: string; on: () => boolean; toggle: () => void }[] = [
    {
      id: 'now',
      label: 'Maintenant, près d’ici',
      icon: 'bolt',
      on: () => this.autonomous() && !!this.near(),
      toggle: () => {
        if (this.autonomous() && this.near()) return this.forget();
        this.autonomous.set(true);
        void this.locate();
      },
    },
    { id: 'today', label: 'Une session aujourd’hui', icon: 'event', on: () => this.session() === 'today', toggle: () => this.session.set(this.session() === 'today' ? null : 'today') },
    { id: 'short', label: 'Moins d’1 h', icon: 'timer', on: () => this.isDuration(DURATION_MIN, 60), toggle: () => this.toggleDuration(DURATION_MIN, 60) },
    { id: 'mid', label: '1 à 2 h', icon: 'schedule', on: () => this.isDuration(60, 120), toggle: () => this.toggleDuration(60, 120) },
    { id: 'long', label: '2 h et plus', icon: 'hourglass_bottom', on: () => this.isDuration(120, DURATION_MAX), toggle: () => this.toggleDuration(120, DURATION_MAX) },
    { id: 'km', label: 'Moins de 3 km', icon: 'straighten', on: () => this.maxKm() === 3, toggle: () => this.maxKm.set(this.maxKm() === 3 ? null : 3) },
    { id: 'family', label: 'En famille', icon: 'family_restroom', on: () => this.audience().includes('family'), toggle: () => this.toggleAudience('family') },
    { id: 'free', label: 'Gratuites', icon: 'money_off', on: () => this.price() === 'free', toggle: () => this.price.set(this.price() === 'free' ? null : 'free') },
  ];

  private isDuration(min: number, max: number): boolean {
    return this.minDuration() === min && this.maxDuration() === max;
  }

  private toggleDuration(min: number, max: number): void {
    const on = this.isDuration(min, max);
    this.minDuration.set(on ? DURATION_MIN : min);
    this.maxDuration.set(on ? DURATION_MAX : max);
  }

  private toggleAudience(a: AudienceTag): void {
    this.audience.update((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]));
  }

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
        practical: this.practical(),
        audience: this.audience(),
        setting: this.setting(),
        price: this.price() ?? undefined,
        maxKm: this.maxKm() ?? undefined,
        session: this.session() ?? undefined,
        minDuration: min > DURATION_MIN ? min : undefined,
        maxDuration: max < DURATION_MAX ? max : undefined,
      };
    },
    stream: ({ params }) => this.api.listCatalog(params),
    defaultValue: [],
  });

  /** Version anglaise (§ 33) : titres et présentations des chasses affichées. */
  private readonly i18n = inject(DomTranslator);
  private readonly translateContent = effect(() => {
    const ids = this.entries.value().map((e) => e.id);
    if (ids.length) untracked(() => this.i18n.requestContent({ catalog: ids.slice(0, 30) }));
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
    this.practical.set([]);
    this.audience.set([]);
    this.setting.set([]);
    this.price.set(null);
    this.maxKm.set(null);
    this.session.set(null);
    this.minDuration.set(DURATION_MIN);
    this.maxDuration.set(DURATION_MAX);
  }
}
