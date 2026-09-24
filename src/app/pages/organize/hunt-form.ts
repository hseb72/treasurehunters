import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router } from '@angular/router';
import { HuntApi } from '../../core/api';
import { Hunt, StartMode } from '../../core/models';
import { Notify } from '../../core/notify';
import { WorkspaceState } from './workspace-state';

/** ISO (UTC) → valeur d'un <input type="datetime-local"> (heure locale). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextSaturday(hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  d.setHours(hour, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

/** Création (/organize/new) et modification (onglet « Infos ») d'une chasse. */
@Component({
  selector: 'th-hunt-form',
  imports: [ReactiveFormsModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hunt-form.html',
  styleUrl: './hunt-form.scss',
})
export class HuntFormPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  private readonly workspace = inject(WorkspaceState, { optional: true });

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(50)]],
    description: ['', Validators.required],
    location: ['', Validators.required],
    award: [''],
    startText: [''],
    begin: [nextSaturday(14), Validators.required],
    end: [nextSaturday(17), Validators.required],
    autoStart: [false],
    autoClose: [true],
    teamGame: [true],
    teamMin: [1, [Validators.min(1)]],
    teamMax: [4, [Validators.min(1)]],
    startMode: ['mass' as StartMode],
    interval: [10, [Validators.min(1)]],
    hintPenalty: [5, [Validators.min(0)]],
    isPublic: [true],
    contribution: [0, [Validators.min(0)]],
  });

  protected readonly hunt = computed(() => this.workspace?.hunt.value() ?? null);
  protected readonly isNew = !this.workspace;
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly teamGame = computed(() => this.values().teamGame);
  protected readonly staggered = computed(() => this.values().startMode === 'staggered');

  constructor() {
    // Chargement de la chasse existante dans le formulaire.
    effect(() => {
      const h = this.hunt();
      if (!h || this.form.dirty) return;
      this.form.reset({
        ...h,
        award: h.award ?? '',
        startText: h.startText ?? '',
        interval: h.interval ?? 10,
        begin: toLocalInput(h.begin),
        end: toLocalInput(h.end),
      });
    });
  }

  protected save(): void {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const data: Partial<Hunt> = {
      ...v,
      id: this.hunt()?.id,
      award: v.award || null,
      startText: v.startText || null,
      interval: v.startMode === 'staggered' ? v.interval : null,
      teamMin: v.teamGame ? v.teamMin : 1,
      teamMax: v.teamGame ? v.teamMax : 1,
      begin: new Date(v.begin).toISOString(),
      end: new Date(v.end).toISOString(),
    };
    this.api.saveHunt(data).subscribe({
      next: (hunt) => {
        this.form.markAsPristine();
        if (this.isNew) {
          this.notify.info('Expédition créée. Place au parcours !');
          this.router.navigate(['/organize', hunt.id, 'steps']);
        } else {
          this.workspace!.hunt.set(hunt);
          this.notify.info('Modifications enregistrées.');
        }
      },
      error: (e) => this.notify.error(e),
    });
  }
}
