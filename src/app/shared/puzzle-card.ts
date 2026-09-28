import { ChangeDetectionStrategy, Component, computed, effect, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PlayPuzzle } from '@shared/models';
import { caesar, puzzleType } from '@shared/puzzles';

/**
 * Énigme d'arrivée (§ 17), à résoudre sur place pour valider l'étape : question ou rébus
 * (réponse à saisir), cadenas à molettes, message chiffré avec sa roue de César, anagramme
 * en tuiles. Une mauvaise réponse fait trembler la carte.
 */
@Component({
  selector: 'th-puzzle-card',
  imports: [FormsModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = puzzle();
    <section class="surface taped puzzle" [class.shake]="shaking()" aria-live="polite">
      <span class="stamp stamp--accent">{{ info().name }}</span>
      <h2>Vous y êtes : {{ p.title }}</h2>
      <p class="small muted">Une dernière épreuve pour valider l'étape.</p>
      <p class="note prompt" [class.rebus]="p.puzzle.type === 'rebus'">{{ p.puzzle.prompt }}</p>

      @switch (p.puzzle.type) {
        @case ('lock') {
          <div class="lock" role="group" aria-label="Cadenas à molettes">
            @for (d of digits(); track $index) {
              <div class="wheel">
                <button type="button" (click)="turn($index, 1)" [attr.aria-label]="'Molette ' + ($index + 1) + ' : chiffre suivant'"><mat-icon>keyboard_arrow_up</mat-icon></button>
                <span class="digit" [attr.aria-label]="'Molette ' + ($index + 1) + ' : ' + d">{{ d }}</span>
                <button type="button" (click)="turn($index, -1)" [attr.aria-label]="'Molette ' + ($index + 1) + ' : chiffre précédent'"><mat-icon>keyboard_arrow_down</mat-icon></button>
              </div>
            }
          </div>
          <button mat-flat-button class="th-cta" type="button" (click)="answer.emit(digits().join(''))" [disabled]="busy()"><mat-icon>lock_open</mat-icon>Ouvrir le cadenas</button>
        }
        @case ('cipher') {
          <p class="cipher" aria-label="Message chiffré">{{ p.puzzle.cipher }}</p>
          <label class="wheel-label">
            Roue de César : décalage <strong>{{ shift() }}</strong>
            <input type="range" min="0" max="25" [ngModel]="shift()" (ngModelChange)="shift.set(+$event)" name="shift" />
          </label>
          <p class="decoded" aria-live="polite">{{ decoded() }}</p>
          <form class="reply" (ngSubmit)="send()">
            <input name="text" [ngModel]="text()" (ngModelChange)="text.set($event)" placeholder="Le message en clair…" autocomplete="off" aria-label="Votre réponse" />
            <button mat-flat-button class="th-cta" type="submit" [disabled]="busy() || !text().trim()">Valider</button>
          </form>
        }
        @case ('anagram') {
          <div class="slots" aria-label="Votre mot">
            @for (i of chosen(); track $index) {
              <button type="button" class="tile placed" (click)="unpick($index)">{{ letters()[i] }}</button>
            }
            @for (i of remainingSlots(); track $index) {
              <span class="tile empty"></span>
            }
          </div>
          <div class="tiles" aria-label="Lettres mélangées">
            @for (l of letters(); track $index) {
              <button type="button" class="tile" [disabled]="chosen().includes($index)" (click)="pick($index)">{{ l }}</button>
            }
          </div>
          <div class="row">
            <button mat-button type="button" (click)="chosen.set([])" [disabled]="!chosen().length"><mat-icon>backspace</mat-icon>Effacer</button>
            <span class="spacer"></span>
            <button mat-flat-button class="th-cta" type="button" (click)="answer.emit(word())" [disabled]="busy() || chosen().length < letters().length">Valider</button>
          </div>
        }
        @default {
          <form class="reply" (ngSubmit)="send()">
            <input name="text" [ngModel]="text()" (ngModelChange)="text.set($event)" placeholder="Votre réponse…" autocomplete="off" aria-label="Votre réponse" />
            <button mat-flat-button class="th-cta" type="submit" [disabled]="busy() || !text().trim()">Valider</button>
          </form>
        }
      }

      <div class="foot">
        @if (p.attempts) {
          <span class="small muted">{{ p.attempts }} essai{{ p.attempts > 1 ? 's' : '' }} sans succès</span>
        }
        <span class="spacer"></span>
        @if (p.hasHint && !p.hintShown) {
          <button mat-button type="button" (click)="hint.emit()" [disabled]="busy()"><mat-icon>tips_and_updates</mat-icon>Voir l'indice</button>
        }
      </div>
      @if (p.puzzle.hint) {
        <p class="hint small"><mat-icon inline>tips_and_updates</mat-icon> {{ p.puzzle.hint }}</p>
      }
    </section>
  `,
  styles: `
    .puzzle { display: flex; flex-direction: column; gap: 10px; }
    .puzzle > .stamp { align-self: flex-start; }
    input[type='range'] { accent-color: var(--th-accent); }
    h2 { margin: 6px 0 0; }
    .prompt { margin: 0; }
    .rebus { font-size: 2rem; line-height: 1.3; text-align: center; letter-spacing: 0.08em; }
    .reply { display: flex; gap: 8px; }
    .reply input { flex: 1; min-width: 0; padding: 12px 14px; border: 1px solid var(--th-border); border-radius: 12px; font: inherit; color: var(--th-ink); background: var(--th-surface-raised); }
    .lock { display: flex; justify-content: center; gap: 8px; padding: 12px; border-radius: 14px; background: var(--th-surface-sunken); }
    .wheel { display: flex; flex-direction: column; align-items: center; }
    .wheel button { border: 0; background: none; color: var(--th-ink); cursor: pointer; padding: 0; }
    .digit { display: grid; place-items: center; width: 44px; height: 56px; border-radius: 8px; font: 700 1.8rem/1 var(--th-font-note); color: var(--th-ink); background: var(--th-surface-raised); border: 2px solid var(--th-border); font-variant-numeric: tabular-nums; }
    .cipher { margin: 0; padding: 12px; border-radius: 12px; font: 700 1.2rem/1.5 ui-monospace, 'Share Tech Mono', monospace; letter-spacing: 0.12em; text-align: center; word-break: break-word; background: var(--th-surface-sunken); }
    .wheel-label { display: flex; flex-direction: column; gap: 4px; font-size: 0.9rem; }
    .decoded { margin: 0; min-height: 1.5em; text-align: center; font: 600 1.05rem/1.4 ui-monospace, monospace; letter-spacing: 0.1em; color: var(--th-ink-soft); }
    .slots, .tiles { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
    .tile { display: grid; place-items: center; width: 38px; height: 42px; border: 2px solid var(--th-border); border-radius: 8px; font: 700 1.2rem var(--th-font-title); color: var(--th-ink); background: var(--th-surface-raised); cursor: pointer; }
    .tile:disabled { opacity: 0.25; cursor: default; }
    .tile.placed { border-color: var(--th-accent); }
    .tile.empty { border-style: dashed; background: transparent; cursor: default; }
    .foot { display: flex; align-items: center; gap: 8px; }
    .hint { margin: 0; padding: 8px 12px; border-radius: 10px; background: color-mix(in srgb, var(--th-accent) 15%, transparent); }
    .shake { animation: shake 0.45s; }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-8px); } 40%, 80% { transform: translateX(8px); } }
    @media (prefers-reduced-motion: reduce) { .shake { animation: none; } }
  `,
})
export class PuzzleCard {
  readonly puzzle = input.required<PlayPuzzle>();
  readonly busy = input(false);
  readonly answer = output<string>();
  readonly hint = output<void>();

  protected readonly info = computed(() => puzzleType(this.puzzle().puzzle.type));
  protected readonly text = signal('');
  protected readonly shaking = signal(false);

  /** Cadenas : molettes à 0 au départ (et à chaque nouvelle énigme). */
  protected readonly digits = linkedSignal(() => Array.from({ length: this.puzzle().puzzle.digits ?? 4 }, () => 0));
  /** Message chiffré : décalage essayé sur la roue. */
  protected readonly shift = signal(0);
  protected readonly decoded = computed(() => caesar(this.puzzle().puzzle.cipher ?? '', -this.shift()));
  /** Anagramme : indices des tuiles placées, dans l'ordre. */
  protected readonly letters = computed(() => this.puzzle().puzzle.letters ?? []);
  protected readonly chosen = linkedSignal<number[]>(() => (this.puzzle().stepId, []));
  protected readonly remainingSlots = computed(() => Array(Math.max(0, this.letters().length - this.chosen().length)));
  protected readonly word = computed(() => this.chosen().map((i) => this.letters()[i]).join(''));


  constructor() {
    // Une réponse fausse de plus : la carte tremble.
    let attempts = -1;
    effect(() => {
      const n = this.puzzle().attempts;
      if (attempts >= 0 && n > attempts) {
        this.shaking.set(false);
        requestAnimationFrame(() => this.shaking.set(true));
        setTimeout(() => this.shaking.set(false), 500);
      }
      attempts = n;
    });
  }

  protected turn(index: number, delta: number): void {
    this.digits.update((d) => d.map((v, i) => (i === index ? (v + delta + 10) % 10 : v)));
  }

  protected pick(index: number): void {
    this.chosen.update((c) => [...c, index]);
  }

  protected unpick(position: number): void {
    this.chosen.update((c) => c.filter((_, i) => i !== position));
  }

  protected send(): void {
    if (this.text().trim()) this.answer.emit(this.text().trim());
  }
}
