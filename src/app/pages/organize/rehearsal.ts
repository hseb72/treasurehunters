import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { minutesLabel } from '@shared/generation';
import { Step } from '@shared/models';
import { arrivalCheck, distanceMeters, finalOrder } from '@shared/rules';
import { HuntApi } from '../../core/api';
import { currentPosition } from '../../core/geo';
import { Notify } from '../../core/notify';
import { ReadAloud } from '../../shared/read-aloud';
import { WorkspaceState } from './workspace-state';

/** Une étape répétée : quand l'auteur y est arrivé, et ce qu'aurait dit la géolocalisation. */
interface Leg {
  order: number;
  at: number;
  distance: number | null;
  allowed: number | null;
  /** true : validable ici ; false : trop loin ; null : sans géolocalisation (QR) ou passée. */
  ok: boolean | null;
  skipped?: boolean;
  /** Le point a été déplacé à l'endroit de l'auteur. */
  moved?: boolean;
}

interface Run {
  startedAt: number;
  legs: Leg[];
}

/**
 * Répétition sur place (§ 30) : l'auteur parcourt sa chasse en conditions réelles, énigme après
 * énigme, pour vérifier distances, validations et temps de parcours. Rien n'est enregistré côté
 * serveur (sauf s'il déplace un point) ; la répétition en cours reste sur son téléphone.
 */
@Component({
  selector: 'th-rehearsal',
  imports: [MatButtonModule, MatIconModule, ReadAloud, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hunt(); as h) {
      <div class="stack">
        <section class="surface intro">
          <h2 class="section-title"><mat-icon>directions_walk</mat-icon> Répétition sur place</h2>
          <p class="small muted">
            Parcourez votre Secret Track comme une équipe : lisez l'énigme, rendez-vous au lieu, puis touchez « Je suis arrivé ».
            Rien ne compte : aucune équipe, aucun classement. Vous saurez si la validation aurait marché, et combien de temps prend chaque étape.
          </p>
        </section>

        @if (unstable().length) {
          <section class="surface warn" role="note">
            @for (r of unstable(); track r.stepId) {
              <p class="small"><mat-icon inline>warning</mat-icon> <strong>Étape {{ r.order }} ({{ r.title }}) : GPS instable.</strong> {{ r.reasons.join(' ; ') }}.</p>
            }
            <p class="small muted">Déplacez le point vers un endroit plus dégagé, élargissez le rayon de validation, ou ajoutez une entrée (onglet Étapes).</p>
          </section>
        }

        @if (!run()) {
          <section class="surface center">
            <p>Commencez au point de départ{{ startName() ? ' : ' + startName() : '' }}.</p>
            <button mat-flat-button class="th-cta" type="button" (click)="begin()" [disabled]="!steps.value().length"><mat-icon>play_arrow</mat-icon>Commencer la répétition</button>
            <a mat-button routerLink="../steps"><mat-icon>edit</mat-icon>Retour aux étapes</a>
          </section>
        } @else if (target(); as t) {
          <section class="surface taped clue">
            <div class="clue-head">
              <span class="stamp">Étape {{ t.order }} / {{ final() }}</span>
              <span class="small muted"><mat-icon inline>timer</mat-icon> {{ since() }} depuis {{ t.order === 1 ? 'le départ' : 'l’étape précédente' }}</span>
            </div>
            @if (riddle(); as r) {
              <div class="row-between">
                <span class="small muted">Énigme lue par les joueurs</span>
                <th-read-aloud [text]="r" />
              </div>
              <p class="note">{{ r }}</p>
            } @else {
              <p class="small error-text"><mat-icon inline>warning</mat-icon> Pas d'énigme rédigée pour mener ici.</p>
            }
            @if (previousHints().length) {
              <details>
                <summary class="small">Voir {{ previousHints().length > 1 ? 'les ' + previousHints().length + ' jokers' : 'le joker' }}</summary>
                <ol class="small">
                  @for (hint of previousHints(); track $index) {
                    <li>{{ hint }}</li>
                  }
                </ol>
              </details>
            }
            <p class="small"><mat-icon inline>flag</mat-icon> Lieu à trouver : <strong>{{ t.title }}</strong></p>
            @if (live(); as l) {
              <div class="live" [class.live--in]="l.ok" role="status" aria-live="polite">
                <mat-icon>{{ l.ok ? 'my_location' : 'location_searching' }}</mat-icon>
                <span>
                  @if (l.distance !== null) {
                    <strong>{{ l.distance }} m</strong> du point · rayon accepté {{ l.allowed }} m
                  } @else {
                    Lieu pas encore placé sur la carte
                  }
                  <span class="muted"> · précision ±{{ l.accuracy }} m</span>
                </span>
                @if (l.ok) {
                  <span class="in">Dans la zone</span>
                }
              </div>
            } @else if (geo() || t.latitude !== null) {
              <p class="small muted"><mat-icon inline>satellite_alt</mat-icon> Recherche de votre position…</p>
            }
            @if (t.puzzle; as pz) {
              <p class="small"><mat-icon inline>extension</mat-icon> Épreuve sur place : {{ pz.prompt }} — réponse : <strong>{{ pz.answer }}</strong></p>
            }

            @if (check(); as c) {
              <div class="result" [class.result--ok]="c.ok" [class.result--ko]="!c.ok" role="status">
                @if (c.ok) {
                  <mat-icon>check_circle</mat-icon> Validé : vous êtes à {{ c.distance }} m du point (accepté jusqu'à {{ c.allowed }} m).
                } @else {
                  <mat-icon>wrong_location</mat-icon> Trop loin : {{ c.distance }} m du point, accepté jusqu'à {{ c.allowed }} m. Une équipe ne pourrait pas valider ici.
                }
              </div>
              <div class="row">
                @if (!c.ok) {
                  <button mat-stroked-button type="button" (click)="moveHere(t)" [disabled]="busy()"><mat-icon>edit_location_alt</mat-icon>Déplacer le point ici</button>
                }
                <button mat-flat-button type="button" (click)="next(t, c)"><mat-icon>arrow_forward</mat-icon>{{ c.ok ? 'Étape suivante' : 'Continuer quand même' }}</button>
              </div>
            } @else {
              <div class="row">
                @if (geo()) {
                  <button mat-flat-button class="th-cta" type="button" (click)="arrived(t)" [disabled]="busy()">
                    <mat-icon>{{ busy() ? 'hourglass_top' : 'where_to_vote' }}</mat-icon>Je suis arrivé
                  </button>
                } @else {
                  <button mat-flat-button class="th-cta" type="button" (click)="next(t, null)"><mat-icon>qr_code_2</mat-icon>QR trouvé, étape suivante</button>
                  @if (t.latitude !== null) {
                    <button mat-stroked-button type="button" (click)="arrived(t)" [disabled]="busy()"><mat-icon>my_location</mat-icon>Vérifier ma position</button>
                  }
                }
                <button mat-button type="button" (click)="skip(t)"><mat-icon>skip_next</mat-icon>Passer</button>
              </div>
            }
          </section>
        } @else {
          <section class="surface center done">
            <mat-icon>emoji_events</mat-icon>
            <h3>Répétition terminée</h3>
            <p>
              Parcours en <strong>{{ total() }}</strong>
              @if (h.durationMinutes) {
                pour {{ minutes(h.durationMinutes) }} annoncées
              }
              · {{ km() }} km à vol d'oiseau.
            </p>
            @if (problems()) {
              <p class="error-text small"><mat-icon inline>warning</mat-icon> {{ problems() }} étape{{ problems() > 1 ? 's' : '' }} n'aurai{{ problems() > 1 ? 'ent' : 't' }} pas pu être validée{{ problems() > 1 ? 's' : '' }} là où vous étiez.</p>
            }
          </section>
        }

        @if (run() && overview().length) {
          <section class="surface">
            <h3 class="section-title">État des étapes</h3>
            <ol class="overview">
              @for (o of overview(); track o.order) {
                <li [class]="'ov ov--' + o.state">
                  <span class="leg-order">{{ o.order }}</span>
                  <span class="leg-title">{{ o.title }}</span>
                  <span class="small muted">{{ o.label }}</span>
                  @if (o.reliability; as rel) {
                    <span class="small" [class.error-text]="rel.unstable">
                      GPS : {{ rel.triggered }}/{{ rel.tests + rel.plays }} déclenché{{ rel.triggered > 1 ? 's' : '' }}{{ rel.far ? ', dont ' + rel.far + ' à plus de 20 m' : '' }}
                    </span>
                  }
                </li>
              }
            </ol>
          </section>
        }

        @if (run(); as r) {
          @if (r.legs.length) {
            <section class="surface">
              <h3 class="section-title">Carnet de répétition</h3>
              <ol class="legs">
                @for (l of legLines(); track l.order) {
                  <li>
                    <span class="leg-order">{{ l.order }}</span>
                    <span class="leg-title">{{ l.title }}</span>
                    <span class="small muted">{{ l.minutes }}</span>
                    <span class="small" [class.error-text]="l.ok === false">{{ l.status }}</span>
                  </li>
                }
              </ol>
            </section>
          }
          <div class="row">
            <span class="spacer"></span>
            <button mat-button type="button" (click)="reset()"><mat-icon>restart_alt</mat-icon>Recommencer</button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .intro p { margin: 0; }
    .center { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
    .center p { margin: 0; }
    .clue { display: flex; flex-direction: column; gap: 8px; }
    .clue p { margin: 0; }
    .clue-head, .row-between { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .result { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 10px; }
    .result--ok { background: color-mix(in srgb, var(--th-success) 14%, transparent); color: var(--th-success); }
    .result--ko { background: color-mix(in srgb, var(--th-danger) 12%, transparent); color: var(--th-danger); }
    .done mat-icon { width: 40px; height: 40px; font-size: 40px; color: var(--th-accent); }
    .done h3 { margin: 0; }
    .legs { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .legs li { display: grid; grid-template-columns: 28px 1fr auto; gap: 2px 8px; align-items: baseline; }
    .legs li > :last-child { grid-column: 2 / -1; }
    .leg-order { font-weight: 700; color: var(--th-primary); }
    .warn { border: 2px solid var(--th-accent); }
    .warn p { margin: 0 0 4px; }
    .live { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border-radius: 10px; background: var(--th-surface-sunken); font-size: 0.9rem; }
    .live mat-icon { color: var(--th-primary); }
    .live--in { background: color-mix(in srgb, var(--th-success) 14%, transparent); }
    .live--in mat-icon, .live .in { color: var(--th-success); font-weight: 600; }
    .overview { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .overview li { display: grid; grid-template-columns: 28px 1fr auto; gap: 2px 8px; align-items: baseline; }
    .overview li > :nth-child(4) { grid-column: 2 / -1; }
    .ov--done .leg-title { color: var(--th-ink-soft); }
    .ov--current .leg-title { font-weight: 700; }
  `,
})
export class RehearsalPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly workspace = inject(WorkspaceState);

  protected readonly hunt = computed(() => this.workspace.hunt.value());
  protected readonly steps = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.getSteps(params),
    defaultValue: [],
  });
  protected readonly geo = computed(() => this.hunt()?.validation === 'geo');
  protected readonly final = computed(() => finalOrder(this.steps.value()));
  protected readonly startName = computed(() => this.steps.value().find((s) => s.order === 0)?.title ?? '');
  protected readonly run = signal<Run | null>(null);
  protected readonly check = signal<{ distance: number; allowed: number; ok: boolean } | null>(null);
  protected readonly busy = signal(false);
  protected readonly minutes = minutesLabel;
  /** Horloge de la page, pour les chronos. */
  private readonly now = signal(Date.now());

  /** Prochain lieu à trouver ; null une fois l'arrivée atteinte. */
  protected readonly target = computed(() => {
    const r = this.run();
    if (!r) return null;
    const order = r.legs.length + 1;
    return order <= this.final() ? (this.steps.value().find((s) => s.order === order) ?? null) : null;
  });
  private readonly previous = computed(() => {
    const t = this.target();
    return t ? this.steps.value().find((s) => s.order === t.order - 1) : undefined;
  });
  protected readonly riddle = computed(() => this.previous()?.instructions?.trim() || null);
  protected readonly previousHints = computed(() => this.previous()?.hints ?? []);
  protected readonly since = computed(() => {
    const r = this.run();
    if (!r) return '';
    const last = r.legs.at(-1)?.at ?? r.startedAt;
    return clock(this.now() - last);
  });
  protected readonly total = computed(() => {
    const r = this.run();
    const end = r?.legs.at(-1)?.at;
    return r && end ? clock(end - r.startedAt) : '';
  });
  /** Fiabilité GPS de chaque étape (§ 42) : tests de l'auteur et arrivées des joueurs. */
  protected readonly reliability = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.gpsReliability(params),
    defaultValue: [],
  });
  protected readonly unstable = computed(() => this.reliability.value().filter((r) => r.unstable));

  /** Position suivie en direct pendant la répétition, et ce qu'en dirait la validation. */
  private readonly position = signal<{ lat: number; lng: number; accuracy: number } | null>(null);
  protected readonly live = computed(() => {
    const p = this.position();
    const t = this.target();
    const h = this.hunt();
    if (!p || !t || !h) return null;
    const c = arrivalCheck(t, h, p);
    return { accuracy: Math.round(p.accuracy), distance: c?.distance ?? null, allowed: c?.allowed ?? null, ok: c?.ok ?? false };
  });

  /** Toutes les étapes : passées, en cours, à venir, avec leur fiabilité GPS. */
  protected readonly overview = computed(() => {
    const r = this.run();
    const current = this.target()?.order ?? Infinity;
    return this.steps
      .value()
      .filter((s) => s.order > 0 && s.order <= this.final())
      .map((s) => {
        const leg = r?.legs.find((l) => l.order === s.order);
        const state = leg ? 'done' : s.order === current ? 'current' : 'todo';
        return {
          order: s.order,
          title: s.title,
          state,
          label: leg ? (leg.skipped ? 'passée' : leg.ok === false && !leg.moved ? 'trop loin' : 'faite') : state === 'current' ? 'en cours' : 'à venir',
          reliability: this.reliability.value().find((x) => x.stepId === s.id && x.tests + x.plays > 0) ?? null,
        };
      });
  });

  protected readonly problems = computed(() => this.run()?.legs.filter((l) => l.ok === false && !l.moved).length ?? 0);
  protected readonly km = computed(() => {
    const placed = this.steps.value().filter((s) => s.latitude !== null && s.longitude !== null);
    const meters = placed.slice(1).reduce((a, s, i) => a + distanceMeters(point(placed[i]!), point(s)), 0);
    return (Math.round(meters / 100) / 10).toLocaleString('fr-FR');
  });
  protected readonly legLines = computed(() => {
    const r = this.run();
    if (!r) return [];
    return r.legs.map((l, i) => ({
      order: l.order,
      ok: l.ok,
      title: this.steps.value().find((s) => s.order === l.order)?.title ?? '',
      minutes: clock(l.at - (i ? r.legs[i - 1]!.at : r.startedAt)),
      status: l.skipped
        ? 'passée'
        : l.moved
          ? `point déplacé ici (${l.distance} m)`
          : l.ok === null
            ? 'trouvée'
            : l.ok
              ? `validable (${l.distance} m)`
              : `trop loin : ${l.distance} m, accepté ${l.allowed} m`,
    }));
  });

  constructor() {
    // Répétition en cours : reprise après un rechargement, sur ce téléphone.
    effect(() => {
      const id = this.workspace.huntId();
      if (id) this.run.set(load(id));
    });
    const timer = setInterval(() => this.now.set(Date.now()), 15_000);
    // Suivi GPS en direct pendant la répétition (§ 42).
    let watch: number | null = null;
    effect(() => {
      const running = !!this.run() && !!this.target();
      if (running && watch === null && 'geolocation' in navigator) {
        watch = navigator.geolocation.watchPosition(
          (p) => this.position.set({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
          () => this.position.set(null),
          { enableHighAccuracy: true, maximumAge: 5_000 },
        );
      } else if (!running && watch !== null) {
        navigator.geolocation.clearWatch(watch);
        watch = null;
      }
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      if (watch !== null) navigator.geolocation.clearWatch(watch);
    });
  }

  protected begin(): void {
    this.save({ startedAt: Date.now(), legs: [] });
  }

  protected reset(): void {
    this.check.set(null);
    this.save(null);
  }

  protected async arrived(t: Step): Promise<void> {
    const h = this.hunt();
    if (!h) return;
    this.busy.set(true);
    try {
      const pos = await currentPosition();
      const c = arrivalCheck(t, h, pos);
      if (!c) this.notify.error(new Error('Ce lieu n’est pas placé sur la carte : placez-le depuis l’onglet Étapes.'));
      this.check.set(c);
      this.lastPos = pos;
      // Noté pour la fiabilité GPS de l'étape ; la répétition continue même hors réseau.
      if (c) this.api.testStep(t.id, pos).subscribe({ next: () => this.reliability.reload(), error: () => undefined });
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  private lastPos: { lat: number; lng: number } | null = null;

  /** Le point était mal placé : il prend la position de l'auteur (les autres entrées sont oubliées). */
  protected moveHere(t: Step): void {
    const pos = this.lastPos;
    if (!pos) return;
    const round = (x: number) => Math.round(x * 1e6) / 1e6;
    this.busy.set(true);
    this.api.saveStep({ id: t.id, huntId: t.huntId, latitude: round(pos.lat), longitude: round(pos.lng) }).subscribe({
      next: () => {
        this.busy.set(false);
        this.notify.info('Point déplacé à votre position.');
        this.steps.reload();
        const c = this.check();
        this.record({ order: t.order, at: Date.now(), distance: c?.distance ?? null, allowed: c?.allowed ?? null, ok: true, moved: true });
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }

  protected next(t: Step, c: { distance: number; allowed: number; ok: boolean } | null): void {
    this.record({ order: t.order, at: Date.now(), distance: c?.distance ?? null, allowed: c?.allowed ?? null, ok: c ? c.ok : null });
  }

  protected skip(t: Step): void {
    this.record({ order: t.order, at: Date.now(), distance: null, allowed: null, ok: null, skipped: true });
  }

  private record(leg: Leg): void {
    const r = this.run();
    if (!r) return;
    this.check.set(null);
    this.now.set(Date.now());
    this.save({ ...r, legs: [...r.legs, leg] });
  }

  private save(r: Run | null): void {
    this.run.set(r);
    const key = storageKey(this.workspace.huntId());
    try {
      if (r) localStorage.setItem(key, JSON.stringify(r));
      else localStorage.removeItem(key);
    } catch {
      // stockage indisponible : la répétition vit le temps de la page
    }
  }
}

function storageKey(huntId: number): string {
  return `th-rehearsal-${huntId}`;
}

function load(huntId: number): Run | null {
  try {
    const raw = localStorage.getItem(storageKey(huntId));
    return raw ? (JSON.parse(raw) as Run) : null;
  } catch {
    return null;
  }
}

function point(s: Step): { lat: number; lng: number } {
  return { lat: s.latitude!, lng: s.longitude! };
}

/** Durée écoulée : « 12 min », « 1 h 05 ». */
function clock(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}
