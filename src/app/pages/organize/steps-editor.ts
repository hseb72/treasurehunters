import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { filter, switchMap } from 'rxjs';
import { HuntApi } from '../../core/api';
import { PhotoShow, Step } from '@shared/models';
import { Notify } from '../../core/notify';
import { currentPosition } from '../../core/geo';
import { compressPhoto } from '../../core/photo';
import { AuthImage } from '../../shared/auth-image';
import { Confirm } from '../../shared/confirm-dialog';
import { LatLng, LocationMap } from '../../shared/location-map';
import { WorkspaceState } from './workspace-state';
import { AssistPanel } from './assist-panel';
import { RouteImport } from './route-import';
import { RouterLink } from '@angular/router';

import { MatSelectModule } from '@angular/material/select';
import { Puzzle, PUZZLE_TYPES, PuzzleType, puzzleType } from '@shared/puzzles';
import { Shop } from '../../core/shop';

@Component({
  selector: 'th-steps-editor',
  imports: [AssistPanel, RouteImport, RouterLink, MatSelectModule, AuthImage, CdkDrag, CdkDropList, NgTemplateOutlet, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, LocationMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './steps-editor.html',
  styleUrl: './steps-editor.scss',
})
export class StepsEditorPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly workspace = inject(WorkspaceState);
  /** Import d'un parcours ouvert (§ 31). */
  protected readonly importing = signal(false);

  protected readonly steps = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.getSteps(params),
    defaultValue: [],
  });

  /** Étape à ouvrir à l'arrivée (« ?step=<id> », depuis la carte du parcours). */
  readonly step = input<string | undefined>();
  private openedFromLink: number | null = null;
  private readonly openRequested = effect(() => {
    const id = Number(this.step());
    const target = this.steps.value().find((s) => s.id === id);
    if (!target || this.openedFromLink === id) return;
    this.openedFromLink = id;
    untracked(() => {
      this.edit(target);
      setTimeout(() => document.getElementById(`step-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
    });
  });

  /** Preuve par photo activée sur le serveur (et chasse à QR codes) : photos de référence. */
  private readonly features = rxResource({ stream: () => this.api.getFeatures() });
  /** Photo du lieu (§ 18) : illustration pour les joueurs, et référence de l'arbitre photo des chasses à QR. */
  protected readonly photos = computed(() => !!this.features.value()?.photos);
  /** Assistant de rédaction (§ 25), si le serveur a une clé d'IA. */
  protected readonly assist = computed(() => !!this.features.value()?.assist);
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
    puzzleType: ['' as PuzzleType | ''],
    puzzlePrompt: [''],
    puzzleAnswer: [''],
    puzzleHint: [''],
    puzzleShift: [3],
    photoShow: ['' as PhotoShow | ''],
  });

  /* ---------- Énigme d'arrivée (§ 17) ---------- */

  protected readonly puzzleTypes = PUZZLE_TYPES;
  protected readonly shop = inject(Shop);
  protected readonly packBusy = signal(false);
  protected readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly puzzleKind = computed(() => this.formValue().puzzleType || null);
  /** Packs d'énigmes pas encore obtenus. */
  protected readonly lockedPacks = computed(() => this.shop.items.value().filter((i) => i.kind === 'pack' && !i.owned && !i.creator));
  /** Packs de créateurs obtenus (§ 19) : des énigmes prêtes à poser. */
  protected readonly creatorPacks = computed(() => this.shop.items.value().filter((i) => i.kind === 'pack' && i.owned && i.creator));
  protected readonly drawPack = signal<string | null>(null);
  protected readonly drawPuzzles = signal<Puzzle[]>([]);

  protected openPack(ref: string): void {
    this.drawPack.set(ref);
    this.drawPuzzles.set([]);
    this.api.packPuzzles(Number(ref.slice(1))).subscribe({
      next: (list) => this.drawPuzzles.set(list),
      error: (e) => this.notify.error(e),
    });
  }

  /** Recopie une énigme du pack dans le formulaire : l'organisateur peut encore l'ajuster. */
  protected usePuzzle(p: Puzzle): void {
    this.form.patchValue({ puzzleType: p.type, puzzlePrompt: p.prompt, puzzleAnswer: p.answer, puzzleHint: p.hint ?? '', puzzleShift: p.shift ?? 3 });
    this.form.markAsDirty();
  }

  protected typeInfo(t: PuzzleType) {
    return puzzleType(t);
  }

  protected packName(id: string): string {
    return this.shop.item(id)?.name ?? '';
  }

  /** Type d'énigme disponible : pack obtenu, ou déjà posé sur l'étape. */
  protected canUsePuzzle(t: PuzzleType, step: Step): boolean {
    return step.puzzle?.type === t || this.shop.owns(puzzleType(t).pack);
  }

  protected promptPlaceholder(t: PuzzleType): string {
    return {
      question: 'Quelle année est gravée au-dessus de la porte ?',
      lock: 'Le code : le nombre de marches du perron, puis le nombre de colonnes.',
      cipher: 'Déchiffrez le message du gardien.',
      anagram: 'Remettez ces lettres dans l’ordre : ce que les marins guettaient la nuit.',
      rebus: '🐟 + 🌙 = ?',
    }[t];
  }

  protected obtainPack(id: string): void {
    this.packBusy.set(true);
    this.shop.obtain(id).subscribe({
      next: () => this.packBusy.set(false),
      error: (e) => {
        this.packBusy.set(false);
        this.notify.error(e);
      },
    });
  }

  /** Proposition de l'assistant acceptée : dans le formulaire, à relire avant d'enregistrer. */
  protected applyInstructions(text: string): void {
    this.form.controls.instructions.setValue(text);
    this.form.markAsDirty();
  }

  protected applyHints(hints: string[]): void {
    this.form.controls.hints.setValue([0, 1, 2].map((i) => hints[i] ?? ''));
    this.form.markAsDirty();
  }

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
      puzzleType: step.puzzle?.type ?? '',
      puzzlePrompt: step.puzzle?.prompt ?? '',
      puzzleAnswer: step.puzzle?.answer ?? '',
      puzzleHint: step.puzzle?.hint ?? '',
      puzzleShift: step.puzzle?.shift ?? 3,
      photoShow: step.photoShow ?? '',
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
        puzzle: v.puzzleType
          ? {
              type: v.puzzleType,
              prompt: v.puzzlePrompt.trim(),
              answer: v.puzzleAnswer.trim(),
              hint: v.puzzleHint.trim() || null,
              ...(v.puzzleType === 'cipher' ? { shift: Number(v.puzzleShift) } : {}),
            }
          : null,
        photoShow: v.photoShow || null,
      })
      .subscribe({
        next: () => {
          this.editing.set(null);
          this.steps.reload();
        },
        error: (e) => this.notify.error(e),
      });
  }

  /**
   * Photo du lieu : référence de l'IA quand une équipe envoie une photo à la place du QR, et
   * illustration montrée aux joueurs si l'organisateur le choisit.
   */
  protected async setReference(step: Step, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.refBusy.set(true);
    try {
      this.updateReference(step, await compressPhoto(file), 'Photo du lieu enregistrée.');
    } catch (e) {
      this.notify.error(e);
      this.refBusy.set(false);
    }
  }

  protected removeReference(step: Step): void {
    this.refBusy.set(true);
    this.updateReference(step, null, 'Photo du lieu retirée.');
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

  protected afterImport(): void {
    this.importing.set(false);
    this.steps.reload();
    this.workspace.hunt.reload();
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
