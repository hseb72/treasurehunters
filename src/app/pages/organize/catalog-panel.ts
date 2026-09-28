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
import { DIFFICULTY_LABELS, TRAVEL_ICONS, TRAVEL_LABELS, TRAVEL_MEANS } from '@shared/generation';
import { Difficulty, Travel } from '@shared/models';
import { HuntApi } from '../../core/api';
import { Shop } from '../../core/shop';
import { PayoutsPanel } from '../../shared/payouts-panel';
import { Notify } from '../../core/notify';
import { CatalogCard } from '../../shared/catalog-card';
import { WorkspaceState } from './workspace-state';

/**
 * Onglet Catalogue (§ 13) : d'où vient la chasse, ce qui en a été publié, et publication
 * d'une nouvelle version (instantané du parcours, extrait choisi, ce qui change).
 */
@Component({
  selector: 'th-catalog-panel',
  imports: [CatalogCard, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, ReactiveFormsModule, RouterLink, PayoutsPanel],
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
  protected readonly travels = (Object.keys(TRAVEL_LABELS) as Travel[]).map((t) => ({ value: t, label: `${TRAVEL_MEANS[t]} · ${TRAVEL_LABELS[t]}`, icon: TRAVEL_ICONS[t] }));
  protected readonly busy = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    summary: [''],
    travel: ['walk' as Travel, Validators.required],
    difficulty: ['medium' as Difficulty, Validators.required],
    durationMinutes: [90, [Validators.required, Validators.min(10), Validators.max(1440)]],
    sampleOrder: [0, Validators.required],
    changes: [''],
    /** Prix au catalogue (§ 20), en euros. */
    euros: [0, [Validators.min(0), Validators.max(50)]],
  });
  protected readonly shop = inject(Shop);

  constructor() {
    // La présentation reprend celle de la chasse, que l'auteur peut ajuster pour le catalogue.
    effect(() => {
      const h = this.hunt();
      if (h && !this.form.controls.summary.dirty) this.form.controls.summary.setValue(h.description);
    });
    // Déplacement, difficulté et durée : ceux de la chasse (demande de génération, copie ou dernière
    // publication) ; sans durée prévue, l'écart entre le début et la fin de la chasse.
    effect(() => {
      const h = this.hunt();
      if (!h) return;
      const c = this.form.controls;
      if (!c.travel.dirty) c.travel.setValue(h.travel);
      if (!c.difficulty.dirty && h.difficulty) c.difficulty.setValue(h.difficulty);
      if (!c.durationMinutes.dirty) c.durationMinutes.setValue(h.durationMinutes ?? this.plannedMinutes(h.begin, h.end));
    });
  }

  private plannedMinutes(begin: string, end: string): number {
    const minutes = Math.round((Date.parse(end) - Date.parse(begin)) / 60_000 / 15) * 15;
    return Math.min(1440, Math.max(10, minutes || 90));
  }

  protected publish(): void {
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.api
      .publishToCatalog(this.workspace.huntId(), {
        summary: v.summary,
        travel: v.travel,
        difficulty: v.difficulty,
        durationMinutes: v.durationMinutes,
        sampleOrder: v.sampleOrder,
        changes: this.isVersion() ? v.changes || null : null,
        price: Math.round((Number(v.euros) || 0) * 100),
      })
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
