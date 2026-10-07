import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { cityOf, HISTORY_LABELS, HistoryEntry, HistoryStatus } from '@shared/journal';
import { minutesLabel } from '@shared/generation';
import { Clock } from '../../core/clock';
import { HuntApi } from '../../core/api';
import { DurationPipe } from '../../shared/format';
import { Stars } from '../../shared/stars';

/**
 * Carnet d'explorateur (§ 29) : les chasses finies, les villes visitées, la distance parcourue
 * et quelques badges. Chaque chasse mène à son souvenir.
 */
@Component({
  selector: 'th-journal',
  imports: [DatePipe, DecimalPipe, DurationPipe, MatButtonModule, MatIconModule, RouterLink, Stars],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack">
      <header class="banner head">
        <h1 class="display">Carnet d'explorateur</h1>
        <p class="small">Toutes vos parties, vos Secret Tracks terminées, les villes où elles vous ont mené, et quelques badges en chemin.</p>
      </header>

      @if (journal.value(); as j) {
        <section class="surface totals">
          <div><strong>{{ j.totals.hunts }}</strong><span class="small muted">Secret Track{{ j.totals.hunts > 1 ? 's' : '' }} finie{{ j.totals.hunts > 1 ? 's' : '' }}</span></div>
          <div><strong>{{ j.totals.steps }}</strong><span class="small muted">lieux trouvés</span></div>
          <div><strong>{{ j.totals.km | number: '1.0-1' : 'fr' }}</strong><span class="small muted">km parcourus</span></div>
          <div><strong>{{ j.cities.length }}</strong><span class="small muted">ville{{ j.cities.length > 1 ? 's' : '' }}</span></div>
        </section>

        <section>
          <h2 class="section-title">Historique de mes parcours</h2>
          @if (j.history.length) {
            <ul class="hunts">
              @for (e of j.history; track e.huntId) {
                <li class="surface hunt">
                  <div class="hunt-main">
                    <span class="row">
                      <strong class="grow">{{ e.name }}</strong>
                      <span class="badge {{ badge(e.status) }}">{{ labels[e.status] }}</span>
                    </span>
                    <span class="small muted">{{ city(e.location) }} · {{ e.date | date: 'd MMMM y' }}</span>
                    <span class="small">
                      @switch (e.status) {
                        @case ('upcoming') {
                          <mat-icon inline>event</mat-icon> Départ prévu le {{ e.date | date: 'd MMMM à HH:mm' }}
                        }
                        @case ('running') {
                          <mat-icon inline>timer</mat-icon> En piste depuis {{ since(e.started) }} · étape {{ e.found + 1 }}/{{ e.total }}
                        }
                        @case ('abandoned') {
                          <mat-icon inline>flag</mat-icon> Abandon après {{ e.time | duration }} · {{ e.found }}/{{ e.total }} lieux trouvés
                        }
                        @case ('unfinished') {
                          <mat-icon inline>hourglass_disabled</mat-icon> {{ e.found }}/{{ e.total }} lieux trouvés avant la clôture
                        }
                        @case ('cancelled') {
                          <mat-icon inline>block</mat-icon> Secret Track annulée par l'organisateur
                        }
                        @default {
                          <mat-icon inline>timer</mat-icon> {{ e.time | duration }}
                          @if (e.referenceMinutes) {
                            <span [class]="faster(e) ? 'ahead' : 'behind'">
                              · {{ e.referenceKind === 'announced' ? 'prévu' : 'meilleur temps' }} {{ minutes(e.referenceMinutes) }} ({{ gap(e) }})
                            </span>
                          }
                          · {{ e.found }}/{{ e.total }} lieux
                          @if (e.rank && e.teams > 1) { · {{ e.rank }}{{ e.rank === 1 ? 'ᵉʳ' : 'ᵉ' }} sur {{ e.teams }} }
                        }
                      }
                    </span>
                    @if (e.stars !== null) {
                      <span class="small mine">Mon avis <th-stars [value]="e.stars" /></span>
                    } @else if (e.canRate) {
                      <a class="small rate" [routerLink]="['/hunts', e.huntId, 'results']" fragment="avis"><mat-icon inline>star_border</mat-icon> Donner mon avis</a>
                    }
                  </div>
                  <a mat-icon-button [routerLink]="link(e)" [attr.aria-label]="action(e)" [title]="action(e)"><mat-icon>{{ icon(e) }}</mat-icon></a>
                </li>
              }
            </ul>
          } @else {
            <p class="muted">Aucune partie pour le moment.</p>
          }
        </section>

        <section>
          <h2 class="section-title">Badges <span class="small muted">· {{ earned() }} / {{ j.badges.length }}</span></h2>
          <ul class="badges">
            @for (b of j.badges; track b.id) {
              <li class="surface award" [class.award--off]="!b.earned" [attr.aria-label]="b.label + (b.earned ? ', obtenu' : ', à obtenir : ' + b.hint)">
                <mat-icon>{{ b.earned ? b.icon : 'lock' }}</mat-icon>
                <strong>{{ b.label }}</strong>
                <span class="small muted">{{ b.hint }}</span>
              </li>
            }
          </ul>
        </section>

        @if (j.cities.length) {
          <section>
            <h2 class="section-title">Villes visitées</h2>
            <p class="cities">
              @for (c of j.cities; track c) {
                <span class="city"><mat-icon inline>location_city</mat-icon> {{ c }}</span>
              }
            </p>
          </section>
        }

        <section>
          <h2 class="section-title">Mes Secret Tracks terminées</h2>
          @if (j.hunts.length) {
            <ul class="hunts">
              @for (h of j.hunts; track h.huntId) {
                <li class="surface hunt">
                  <div class="hunt-main">
                    <strong>{{ h.name }}</strong>
                    <span class="small muted">{{ city(h.location) }} · {{ h.date | date: 'd MMMM y' }}{{ h.autonomous ? ' · en autonomie' : '' }}</span>
                    <span class="small">
                      <mat-icon inline>timer</mat-icon> {{ h.time | duration }} · {{ h.found }} lieux
                      @if (h.km) { · {{ h.km | number: '1.0-1' : 'fr' }} km }
                      · {{ h.hints ? h.hints + ' joker' + (h.hints > 1 ? 's' : '') : 'sans joker' }}
                    </span>
                  </div>
                  <a mat-icon-button [routerLink]="['/hunts', h.huntId, 'souvenir']" aria-label="Souvenir de cette Secret Track" title="Souvenir"><mat-icon>photo_album</mat-icon></a>
                </li>
              }
            </ul>
          } @else {
            <div class="surface center">
              <mat-icon>explore</mat-icon>
              <p class="muted">Votre carnet est encore vierge : trouvez votre premier trésor !</p>
              <a mat-flat-button routerLink="/catalog" [queryParams]="{ jouer: 1 }"><mat-icon>hiking</mat-icon>Choisir une Secret Track</a>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .head { display: flex; flex-direction: column; gap: 4px; padding: 20px; }
    .head h1, .head p { margin: 0; }
    .head p { color: var(--th-surface-raised); }
    .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; text-align: center; }
    .totals div { display: flex; flex-direction: column; }
    .totals strong { font-size: 1.6rem; color: var(--th-primary); }
    @media (max-width: 420px) { .totals { grid-template-columns: repeat(2, 1fr); } }
    .badges { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
    /* « award » et non « badge » : .badge est l'étiquette de statut de l'application (pastille d'une ligne). */
    .award { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; text-align: center; gap: 4px; padding: 12px; min-width: 0; overflow-wrap: anywhere; }
    .award strong { line-height: 1.25; }
    .award mat-icon { width: 32px; height: 32px; font-size: 32px; color: var(--th-accent); }
    .award--off { opacity: 0.6; }
    .award--off mat-icon { color: var(--th-ink-soft); }
    .cities { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
    .city { padding: 4px 10px; border-radius: 999px; background: var(--th-surface-sunken); }
    .hunts { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .hunt { display: flex; align-items: center; gap: 8px; }
    .hunt-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .row { display: flex; align-items: center; gap: 8px; }
    .grow { flex: 1; min-width: 0; }
    .ahead { color: var(--th-success, #2e7d32); }
    .behind { color: var(--th-ink-soft); }
    .stars { display: inline-flex; color: var(--th-accent); }
    .mine { display: inline-flex; align-items: center; gap: 6px; }
    .rate { display: inline-flex; align-items: center; gap: 4px; color: var(--th-primary); }
    .center { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
    .center p { margin: 0; }
  `,
})
export class JournalPage {
  private readonly api = inject(HuntApi);
  protected readonly journal = rxResource({ stream: () => this.api.getJournal() });
  protected readonly earned = computed(() => this.journal.value()?.badges.filter((b) => b.earned).length ?? 0);
  protected readonly city = cityOf;
  protected readonly labels = HISTORY_LABELS;
  protected readonly minutes = minutesLabel;
  private readonly clock = inject(Clock);

  protected badge(status: HistoryStatus): string {
    const map: Record<HistoryStatus, string> = {
      upcoming: 'badge--published',
      running: 'badge--running',
      finished: 'badge--accent',
      treasure_skipped: 'badge--closed',
      abandoned: 'badge--cancelled',
      unfinished: 'badge--closed',
      cancelled: 'badge--cancelled',
    };
    return map[status];
  }

  /** Plus rapide que la référence ? */
  protected faster(e: HistoryEntry): boolean {
    return e.time !== null && e.referenceMinutes !== null && e.time <= e.referenceMinutes * 60;
  }

  /** Écart à la référence : « 18 min de moins », « 7 min de plus ». */
  protected gap(e: HistoryEntry): string {
    const diff = Math.round(((e.time ?? 0) - (e.referenceMinutes ?? 0) * 60) / 60);
    if (diff === 0) return 'pile à l’heure';
    return `${minutesLabel(Math.abs(diff))} de ${diff < 0 ? 'moins' : 'plus'}`;
  }

  protected since(iso: string | null): string {
    if (!iso) return '';
    return minutesLabel(Math.max(1, Math.round((this.clock.now() - Date.parse(iso)) / 60_000)));
  }

  protected link(e: HistoryEntry): unknown[] {
    if (e.status === 'running' || e.status === 'upcoming') return ['/play', e.huntId];
    if (e.status === 'finished' || e.status === 'treasure_skipped') return ['/hunts', e.huntId, 'souvenir'];
    return ['/hunts', e.huntId, 'results'];
  }

  protected icon(e: HistoryEntry): string {
    return e.status === 'running' ? 'play_circle' : e.status === 'upcoming' ? 'event' : e.status === 'finished' || e.status === 'treasure_skipped' ? 'photo_album' : 'emoji_events';
  }

  protected action(e: HistoryEntry): string {
    return e.status === 'running' ? 'Reprendre la partie' : e.status === 'upcoming' ? 'Voir la partie' : e.status === 'finished' || e.status === 'treasure_skipped' ? 'Souvenir' : 'Résultats';
  }
}
