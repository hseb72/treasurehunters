import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { DIFFICULTY_LABELS } from '@shared/generation';
import { Difficulty } from '@shared/models';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';
import { CatalogCard } from '../../shared/catalog-card';
import { WorkspaceState } from './workspace-state';

/**
 * Onglet Catalogue (§ 13) : d'où vient la chasse, ce qui en a été publié, et publication
 * d'une nouvelle version (instantané du parcours, extrait choisi, ce qui change).
 */
@Component({
  selector: 'th-catalog-panel',
  imports: [CatalogCard, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-panel.html',
  styleUrl: './catalog-panel.scss',
})
export class CatalogPanelPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  protected readonly workspace = inject(WorkspaceState);

  protected readonly hunt = computed(() => this.workspace.hunt.value());
  protected readonly steps = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.getSteps(params),
    defaultValue: [],
  });
  /** Versions déjà publiées à partir de cette chasse. */
  protected readonly published = rxResource({
    params: () => this.workspace.huntId() || undefined,
    stream: ({ params }) => this.api.listCatalog({ hunt: params }),
    defaultValue: [],
  });
  /** Version du catalogue dont la chasse est une copie. */
  protected readonly origin = rxResource({
    params: () => this.hunt()?.catalogId ?? undefined,
    stream: ({ params }) => (params ? this.api.getCatalogEntry(params) : of(null)),
  });

  /** Énigmes rédigées, proposées comme extrait. */
  protected readonly riddles = computed(() => {
    const steps = this.steps.value();
    return steps.filter((s) => s.order < steps.length - 1 && s.instructions?.trim());
  });
  /** Une nouvelle version d'une chasse déjà publiée ou copiée dit ce qui change. */
  protected readonly isVersion = computed(() => !!this.hunt()?.catalogId || this.published.value().length > 0);
  protected readonly difficulties = Object.entries(DIFFICULTY_LABELS) as [Difficulty, string][];
  protected readonly busy = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    summary: [''],
    difficulty: ['medium' as Difficulty, Validators.required],
    durationMinutes: [90, [Validators.required, Validators.min(10), Validators.max(1440)]],
    sampleOrder: [0, Validators.required],
    changes: [''],
  });

  constructor() {
    // La présentation reprend celle de la chasse, que l'auteur peut ajuster pour le catalogue.
    effect(() => {
      const h = this.hunt();
      if (h && !this.form.controls.summary.dirty) this.form.controls.summary.setValue(h.description);
    });
  }

  protected publish(): void {
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.api
      .publishToCatalog(this.workspace.huntId(), { ...v, summary: v.summary, changes: this.isVersion() ? v.changes || null : null })
      .subscribe({
        next: () => {
          this.notify.info('Publiée au catalogue : les autres organisateurs peuvent la découvrir.');
          this.published.reload();
          this.form.controls.changes.reset('');
          this.busy.set(false);
        },
        error: (e) => {
          this.notify.error(e);
          this.busy.set(false);
        },
      });
  }
}
