import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { cityOf } from '@shared/journal';
import { HuntApi } from '../../core/api';
import { DurationPipe } from '../../shared/format';

/**
 * Carnet d'explorateur (§ 29) : les chasses finies, les villes visitées, la distance parcourue
 * et quelques badges. Chaque chasse mène à son souvenir.
 */
@Component({
  selector: 'th-journal',
  imports: [DatePipe, DecimalPipe, DurationPipe, MatButtonModule, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack">
      <header class="banner head">
        <h1 class="display">Carnet d'explorateur</h1>
        <p class="small">Vos Secret Tracks terminées, les villes où elles vous ont mené, et quelques badges en chemin.</p>
      </header>

      @if (journal.value(); as j) {
        <section class="surface totals">
          <div><strong>{{ j.totals.hunts }}</strong><span class="small muted">Secret Track{{ j.totals.hunts > 1 ? 's' : '' }} finie{{ j.totals.hunts > 1 ? 's' : '' }}</span></div>
          <div><strong>{{ j.totals.steps }}</strong><span class="small muted">lieux trouvés</span></div>
          <div><strong>{{ j.totals.km | number: '1.0-1' : 'fr' }}</strong><span class="small muted">km parcourus</span></div>
          <div><strong>{{ j.cities.length }}</strong><span class="small muted">ville{{ j.cities.length > 1 ? 's' : '' }}</span></div>
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
    .center { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
    .center p { margin: 0; }
  `,
})
export class JournalPage {
  private readonly api = inject(HuntApi);
  protected readonly journal = rxResource({ stream: () => this.api.getJournal() });
  protected readonly earned = computed(() => this.journal.value()?.badges.filter((b) => b.earned).length ?? 0);
  protected readonly city = cityOf;
}
