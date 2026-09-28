import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { PackContent } from '@shared/creations';
import { Puzzle, puzzleProblem, PUZZLE_TYPES } from '@shared/puzzles';

/** Éditeur d'un pack de créateur (§ 19) : des énigmes d'arrivée prêtes à poser, contrôlées une à une. */
@Component({
  selector: 'th-pack-editor',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="small muted">
      Des énigmes qui se suffisent à elles-mêmes (elles serviront sur n'importe quel lieu) : anagrammes, messages chiffrés, rébus, cadenas dont le code se
      déduit de la consigne. Au moins 3, au plus 40.
    </p>
    <ol class="puzzles">
      @for (p of content().puzzles; track $index; let i = $index) {
        <li class="puzzle">
          <div class="row">
            <mat-form-field subscriptSizing="dynamic" class="type">
              <mat-label>Type</mat-label>
              <mat-select [value]="p.type" (selectionChange)="set(i, { type: $event.value })">
                @for (t of types; track t.type) {
                  <mat-option [value]="t.type">{{ t.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <span class="spacer"></span>
            <button mat-icon-button type="button" (click)="remove(i)" aria-label="Retirer cette énigme"><mat-icon>delete</mat-icon></button>
          </div>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Consigne</mat-label>
            <textarea matInput rows="2" [ngModel]="p.prompt" (ngModelChange)="set(i, { prompt: $event })"></textarea>
          </mat-form-field>
          <div class="row">
            <mat-form-field subscriptSizing="dynamic" class="grow">
              <mat-label>Réponse</mat-label>
              <input matInput [ngModel]="p.answer" (ngModelChange)="set(i, { answer: $event })" />
            </mat-form-field>
            @if (p.type === 'cipher') {
              <mat-form-field subscriptSizing="dynamic" class="shift">
                <mat-label>Décalage</mat-label>
                <input matInput type="number" min="1" max="25" [ngModel]="p.shift ?? 3" (ngModelChange)="set(i, { shift: +$event })" />
              </mat-form-field>
            }
          </div>
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Indice</mat-label>
            <input matInput [ngModel]="p.hint ?? ''" (ngModelChange)="set(i, { hint: $event })" />
          </mat-form-field>
          @if (problem(p); as pb) {
            <p class="small problem"><mat-icon inline>error</mat-icon> {{ pb }}</p>
          }
        </li>
      }
    </ol>
    <button mat-stroked-button type="button" (click)="add()" [disabled]="content().puzzles.length >= 40"><mat-icon>add</mat-icon>Ajouter une énigme</button>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; }
    .puzzles { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 12px; }
    .puzzle { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px dashed var(--th-border); border-radius: 10px; }
    .row { display: flex; align-items: center; gap: 8px; }
    .spacer, .grow { flex: 1; }
    .type { min-width: 200px; }
    .shift { width: 110px; }
    .problem { margin: 0; color: var(--th-danger); }
  `,
})
export class PackEditor {
  readonly content = model.required<PackContent>();
  protected readonly types = PUZZLE_TYPES;

  protected problem(p: Puzzle): string | null {
    return puzzleProblem({ ...p, shift: p.type === 'cipher' ? (p.shift ?? 3) : undefined });
  }

  protected set(i: number, patch: Partial<Puzzle>): void {
    this.content.update((c) => ({ puzzles: c.puzzles.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  }

  protected add(): void {
    this.content.update((c) => ({ puzzles: [...c.puzzles, { type: 'anagram', prompt: '', answer: '', hint: '' }] }));
  }

  protected remove(i: number): void {
    this.content.update((c) => ({ puzzles: c.puzzles.filter((_, j) => j !== i) }));
  }
}
