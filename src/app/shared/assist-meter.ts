import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ASSIST_ACTIONS, ASSIST_LIMITS, AssistUsage } from '@shared/assist';

/**
 * Décompte de l'assistant de rédaction (§ 25) : une pastille « 18 / 30 » toujours visible,
 * qui s'ouvre sur le détail — ce qui a été utilisé, par nature, aujourd'hui, et quand les
 * suggestions reviennent. De quoi choisir ce qui mérite une relecture ou une reformulation.
 */
@Component({
  selector: 'th-assist-meter',
  imports: [DatePipe, MatButtonModule, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let u = usage();
    <button type="button" class="chip chip--{{ level() }}" (click)="open.set(!open())" [attr.aria-expanded]="open()" aria-controls="assist-detail"
      [attr.aria-label]="u.remaining + ' suggestions restantes sur ' + u.limit + ' : voir le détail'">
      <mat-icon>auto_awesome</mat-icon>
      <strong>{{ u.remaining }}</strong><span class="of">/ {{ u.limit }}</span>
      <span class="label">{{ expanded() ? 'suggestions restantes' : 'restantes' }}</span>
      <mat-icon class="caret">{{ open() ? 'expand_less' : 'expand_more' }}</mat-icon>
    </button>

    @if (open()) {
      <div class="detail" id="assist-detail">
        <div class="bar" role="meter" aria-label="Suggestions utilisées sur 30 jours" [attr.aria-valuenow]="u.used" aria-valuemin="0" [attr.aria-valuemax]="u.limit">
          <span [style.width.%]="percent()"></span>
        </div>
        <p class="line">
          <strong>{{ u.used }}</strong> utilisée{{ u.used > 1 ? 's' : '' }} sur les 30 derniers jours · <strong>{{ u.remaining }}</strong> restante{{ u.remaining > 1 ? 's' : '' }}
        </p>
        @if (u.used) {
          <ul class="by">
            @for (a of actions; track a.id) {
              @if (u.byAction[a.id]) {
                <li><mat-icon>{{ a.icon }}</mat-icon>{{ u.byAction[a.id] }} {{ a.short[u.byAction[a.id] > 1 ? 1 : 0] }}</li>
              }
            }
          </ul>
        }
        <p class="small">Aujourd'hui : {{ u.today }} / {{ u.daily }}.</p>
        @if (u.nextRefill) {
          <p class="small">
            <mat-icon inline>update</mat-icon> Chaque suggestion revient 30 jours après avoir servi : la prochaine le
            <strong>{{ u.nextRefill | date: 'd MMMM' }}</strong>.
          </p>
        }
        <p class="small muted">
          @switch (u.plan) {
            @case ('founder') {
              Membre fondateur : {{ limits.passMonthly }} suggestions par 30 jours.
            }
            @case ('pass') {
              Avec votre forfait de chasses sur mesure : {{ limits.passMonthly }} suggestions par 30 jours.
            }
            @default {
              {{ limits.monthly }} suggestions offertes par 30 jours ; {{ limits.passMonthly }} avec un
              <a routerLink="/me" fragment="portefeuille">forfait de chasses sur mesure</a>.
            }
          }
          Une demande qui échoue n'est pas décomptée. <a routerLink="/conditions" fragment="assistant">Limites d'usage</a>
        </p>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .chip {
      align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px 4px 10px;
      border-radius: 999px; border: 1px solid currentColor; background: transparent; font: inherit; cursor: pointer;
      mat-icon { width: 18px; height: 18px; font-size: 18px; }
      .of, .label { opacity: 0.8; font-size: 0.85rem; }
    }
    .chip--ok { color: var(--th-success); }
    .chip--low { color: var(--th-accent); }
    .chip--out { color: var(--th-danger); }
    .detail { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 12px; background: var(--th-surface-sunken); }
    .detail p { margin: 0; }
    .bar { height: 8px; border-radius: 999px; background: var(--th-border); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--th-primary); }
    .by { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0; padding: 0; list-style: none; font-size: 0.9rem; }
    .by li { display: inline-flex; align-items: center; gap: 4px; }
    .by mat-icon { width: 18px; height: 18px; font-size: 18px; color: var(--th-primary); }
  `,
})
export class AssistMeterView {
  readonly usage = input.required<AssistUsage>();
  /** Libellé long dans la pastille (profil) ; court dans l'éditeur. */
  readonly expanded = input(false);
  /** Détail ouvert d'emblée (profil). */
  readonly startOpen = input(false);
  protected readonly open = signal(false);
  protected readonly actions = ASSIST_ACTIONS;
  protected readonly limits = ASSIST_LIMITS;
  protected readonly percent = computed(() => Math.min(100, (this.usage().used / Math.max(1, this.usage().limit)) * 100));
  /** Vert, puis orange sous 20 % restants, rouge à zéro. */
  protected readonly level = computed(() => {
    const u = this.usage();
    return u.remaining === 0 || u.blocked ? 'out' : u.remaining <= u.limit * 0.2 ? 'low' : 'ok';
  });

  ngOnInit(): void {
    this.open.set(this.startOpen());
  }
}
