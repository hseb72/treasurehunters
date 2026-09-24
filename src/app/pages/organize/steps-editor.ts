import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { filter, switchMap } from 'rxjs';
import { HuntApi } from '../../core/api';
import { Step } from '@shared/models';
import { Notify } from '../../core/notify';
import { Confirm } from '../../shared/confirm-dialog';
import { WorkspaceState } from './workspace-state';

@Component({
  selector: 'th-steps-editor',
  imports: [CdkDrag, CdkDropList, NgTemplateOutlet, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './steps-editor.html',
  styleUrl: './steps-editor.scss',
})
export class StepsEditorPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly workspace = inject(WorkspaceState);

  protected readonly steps = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.getSteps(params),
    defaultValue: [],
  });

  protected readonly start = computed(() => this.steps.value()[0]);
  protected readonly middle = computed(() => this.steps.value().slice(1, -1));
  protected readonly arrival = computed(() => {
    const all = this.steps.value();
    return all.length > 1 ? all[all.length - 1] : undefined;
  });
  /** Le parcours ne se restructure plus une fois la chasse lancée. */
  protected readonly locked = computed(() => !['draft', 'published'].includes(this.workspace.hunt.value()?.status ?? 'draft'));

  protected readonly editing = signal<number | null>(null);
  protected readonly form = this.fb.group({
    title: [''],
    address: [''],
    arrival: [''],
    instructions: [''],
    hints: this.fb.array(['', '', '']),
  });

  protected get hints(): FormArray {
    return this.form.controls.hints;
  }

  protected edit(step: Step): void {
    this.editing.set(step.id);
    this.form.reset({
      title: step.title,
      address: step.address ?? '',
      arrival: step.arrival ?? '',
      instructions: step.instructions ?? '',
      hints: [0, 1, 2].map((i) => step.hints[i] ?? ''),
    });
  }

  protected save(step: Step): void {
    const v = this.form.getRawValue();
    this.api
      .saveStep({
        id: step.id,
        huntId: step.huntId,
        title: v.title,
        address: v.address || null,
        arrival: v.arrival || null,
        instructions: v.instructions || null,
        hints: v.hints.filter((h) => h.trim()),
      })
      .subscribe({
        next: () => {
          this.editing.set(null);
          this.steps.reload();
        },
        error: (e) => this.notify.error(e),
      });
  }

  protected add(): void {
    this.api.saveStep({ huntId: this.workspace.huntId() }).subscribe({
      next: (step) => {
        this.steps.reload();
        this.edit(step);
        this.workspace.hunt.reload();
      },
      error: (e) => this.notify.error(e),
    });
  }

  protected remove(step: Step): void {
    this.confirm
      .ask({ title: `Supprimer l’étape ${step.order} ?`, message: step.title, confirm: 'Supprimer', danger: true })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.deleteStep(step.id)),
      )
      .subscribe({
        next: () => {
          this.steps.reload();
          this.workspace.hunt.reload();
        },
        error: (e) => this.notify.error(e),
      });
  }

  protected drop(event: CdkDragDrop<Step[]>): void {
    const ids = this.middle().map((s) => s.id);
    moveItemInArray(ids, event.previousIndex, event.currentIndex);
    this.api.reorderSteps(this.workspace.huntId(), ids).subscribe({
      next: (steps) => this.steps.set(steps),
      error: (e) => this.notify.error(e),
    });
  }
}
