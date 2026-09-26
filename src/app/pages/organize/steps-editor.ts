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
import { currentPosition } from '../../core/geo';
import { compressPhoto } from '../../core/photo';
import { AuthImage } from '../../shared/auth-image';
import { Confirm } from '../../shared/confirm-dialog';
import { LatLng, LocationMap } from '../../shared/location-map';
import { WorkspaceState } from './workspace-state';

@Component({
  selector: 'th-steps-editor',
  imports: [AuthImage, CdkDrag, CdkDropList, NgTemplateOutlet, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, LocationMap],
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

  /** Preuve par photo activée sur le serveur (et chasse à QR codes) : photos de référence. */
  private readonly features = rxResource({ stream: () => this.api.getFeatures() });
  protected readonly photos = computed(() => !!this.features.value()?.photos && !this.geo());
  /** Envoi d'une photo de référence en cours, et compteur pour recharger l'aperçu. */
  protected readonly refBusy = signal(false);
  protected readonly refVersion = signal(0);

  protected readonly start = computed(() => this.steps.value()[0]);
  protected readonly middle = computed(() => this.steps.value().slice(1, -1));
  protected readonly arrival = computed(() => {
    const all = this.steps.value();
    return all.length > 1 ? all[all.length - 1] : undefined;
  });
  /** Le parcours ne se restructure plus une fois la chasse lancée. */
  protected readonly locked = computed(() => !['draft', 'published'].includes(this.workspace.hunt.value()?.status ?? 'draft'));

  /** Chasse validée par géolocalisation : chaque lieu doit être placé sur la carte. */
  protected readonly geo = computed(() => this.workspace.hunt.value()?.validation === 'geo');

  protected readonly editing = signal<number | null>(null);
  /** Point du lieu en cours d'édition (miroir des champs latitude / longitude). */
  protected readonly point = signal<LatLng | null>(null);
  protected readonly form = this.fb.group({
    title: [''],
    address: [''],
    latitude: [null as number | null],
    longitude: [null as number | null],
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
      latitude: step.latitude,
      longitude: step.longitude,
      arrival: step.arrival ?? '',
      instructions: step.instructions ?? '',
      hints: [0, 1, 2].map((i) => step.hints[i] ?? ''),
    });
    this.point.set(step.latitude !== null && step.longitude !== null ? { lat: step.latitude, lng: step.longitude } : null);
  }

  protected place(p: LatLng): void {
    const round = (x: number) => Math.round(x * 1e6) / 1e6;
    this.point.set(p);
    this.form.patchValue({ latitude: round(p.lat), longitude: round(p.lng) });
    this.form.markAsDirty();
  }

  /** Sur le terrain : le lieu est là où se tient l'organisateur. */
  protected async here(): Promise<void> {
    try {
      this.place(await currentPosition());
    } catch (e) {
      this.notify.error(e);
    }
  }

  protected save(step: Step): void {
    const v = this.form.getRawValue();
    this.api
      .saveStep({
        id: step.id,
        huntId: step.huntId,
        title: v.title,
        address: v.address || null,
        latitude: v.latitude,
        longitude: v.longitude,
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

  /** Photo du lieu où le QR est posé : référence de l'IA quand une équipe envoie une photo à la place du QR. */
  protected async setReference(step: Step, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.refBusy.set(true);
    try {
      this.updateReference(step, await compressPhoto(file), 'Photo de référence enregistrée.');
    } catch (e) {
      this.notify.error(e);
      this.refBusy.set(false);
    }
  }

  protected removeReference(step: Step): void {
    this.refBusy.set(true);
    this.updateReference(step, null, 'Photo de référence retirée.');
  }

  private updateReference(step: Step, image: string | null, done: string): void {
    this.api.setReferencePhoto(step.id, image).subscribe({
      next: (updated) => {
        this.steps.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
        this.refVersion.update((v) => v + 1);
        this.refBusy.set(false);
        this.notify.info(done);
      },
      error: (e) => {
        this.notify.error(e);
        this.refBusy.set(false);
      },
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
