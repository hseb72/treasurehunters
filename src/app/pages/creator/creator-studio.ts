import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { Creation, CreationKind, CreationStatus, PackContent, SkinContent } from '@shared/creations';
import { puzzleType } from '@shared/puzzles';
import { skinById } from '@shared/skins';
import { priceLabel } from '@shared/store';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';
import { Shop } from '../../core/shop';
import { SkinDirective } from '../../shared/skin';
import { PackEditor } from './pack-editor';
import { contentFrom, SkinEditor } from './skin-editor';

interface Draft {
  id: number | null;
  kind: CreationKind;
  name: string;
  description: string;
  /** Prix affiché, en euros. */
  euros: number;
  skin: SkinContent;
  pack: PackContent;
}

const STATUS: Record<CreationStatus, { label: string; badge: string; icon: string }> = {
  draft: { label: 'Brouillon', badge: 'badge--draft', icon: 'edit_note' },
  review: { label: 'En relecture', badge: 'badge--published', icon: 'hourglass_top' },
  published: { label: 'Publiée', badge: 'badge--running', icon: 'storefront' },
  rejected: { label: 'À corriger', badge: 'badge--cancelled', icon: 'report' },
};

/**
 * Atelier créateur (§ 19) : proposer des skins et des packs d'énigmes, les faire relire,
 * les retrouver dans la boutique une fois publiés. Les relecteurs y publient ou refusent.
 */
@Component({
  selector: 'th-creator-studio',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, RouterLink, SkinDirective, SkinEditor, PackEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-studio.html',
  styleUrl: './creator-studio.scss',
})
export class CreatorStudioPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly shop = inject(Shop);
  protected readonly session = inject(Session);

  protected readonly tab = signal<'mine' | 'review'>('mine');
  protected readonly mine = rxResource({ params: () => this.session.user()?.id ?? 0, stream: () => this.api.myCreations(), defaultValue: [] as Creation[] });
  protected readonly queue = rxResource({
    params: () => (this.session.user()?.reviewer ? this.session.user()!.id : 0),
    stream: ({ params }) => (params ? this.api.reviewQueue() : of([] as Creation[])),
    defaultValue: [] as Creation[],
  });
  protected readonly reviewer = computed(() => !!this.session.user()?.reviewer);

  protected readonly draft = signal<Draft | null>(null);
  protected readonly problems = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly notes = signal<Record<number, string>>({});
  protected readonly status = STATUS;
  protected readonly price = (c: Creation) => (c.price ? priceLabel({ price: c.price, included: false }) : 'Offert');
  protected readonly typeName = (t: Parameters<typeof puzzleType>[0]) => puzzleType(t).name;

  protected create(kind: CreationKind): void {
    this.problems.set([]);
    this.draft.set({
      id: null,
      kind,
      name: '',
      description: '',
      euros: kind === 'skin' ? 1.99 : 2.99,
      skin: contentFrom(skinById('aventure')),
      pack: { puzzles: [{ type: 'anagram', prompt: '', answer: '', hint: '' }] },
    });
  }

  protected edit(c: Creation): void {
    this.problems.set(c.problems ?? []);
    this.draft.set({
      id: c.id,
      kind: c.kind,
      name: c.name,
      description: c.description,
      euros: c.price / 100,
      skin: c.kind === 'skin' ? (c.content as SkinContent) : contentFrom(skinById('aventure')),
      pack: c.kind === 'pack' ? (c.content as PackContent) : { puzzles: [] },
    });
  }

  protected patchDraft(p: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...p } : d));
  }

  /** Enregistre le brouillon ; `submit` : puis le propose à la relecture. */
  protected save(submit: boolean): void {
    const d = this.draft();
    if (!d) return;
    const data = { name: d.name, description: d.description, price: Math.round(Math.min(20, Math.max(0, d.euros || 0)) * 100), content: d.kind === 'skin' ? d.skin : d.pack };
    this.busy.set(true);
    const saved$ = d.id ? this.api.updateCreation(d.id, data) : this.api.createCreation({ kind: d.kind, ...data });
    saved$.subscribe({
      next: (c) => {
        this.patchDraft({ id: c.id, skin: c.kind === 'skin' ? (c.content as SkinContent) : d.skin });
        this.problems.set(c.problems ?? []);
        this.mine.reload();
        if (!submit) {
          this.busy.set(false);
          this.notify.info(c.problems?.length ? 'Brouillon enregistré : il reste des points à corriger avant la relecture.' : 'Brouillon enregistré.');
          return;
        }
        this.api.submitCreation(c.id).subscribe({
          next: () => {
            this.busy.set(false);
            this.draft.set(null);
            this.mine.reload();
            this.notify.info('Création proposée : un relecteur la publiera ou vous dira quoi corriger.', 6000);
          },
          error: (e) => {
            this.busy.set(false);
            this.notify.error(e);
          },
        });
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }

  protected withdraw(c: Creation): void {
    this.api.withdrawCreation(c.id).subscribe({ next: () => this.mine.reload(), error: (e) => this.notify.error(e) });
  }

  protected remove(c: Creation): void {
    this.api.deleteCreation(c.id).subscribe({
      next: () => {
        this.mine.reload();
        this.notify.info(`« ${c.name} » supprimée.`);
      },
      error: (e) => this.notify.error(e),
    });
  }

  protected setNote(id: number, note: string): void {
    this.notes.update((n) => ({ ...n, [id]: note }));
  }

  protected review(c: Creation, approve: boolean): void {
    this.busy.set(true);
    this.api.reviewCreation(c.id, approve, this.notes()[c.id]?.trim() || null).subscribe({
      next: () => {
        this.busy.set(false);
        this.queue.reload();
        this.shop.items.reload();
        this.notify.info(approve ? `« ${c.name} » est publiée dans la boutique.` : `« ${c.name} » est renvoyée à son créateur.`);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }

  /** Manifeste d'aperçu d'une création à relire. */
  protected previewOf(c: Creation) {
    return { id: `u${c.id}`, name: c.name, description: c.description, author: c.authorNickname, price: c.price, ...(c.content as SkinContent) };
  }

  protected puzzlesOf(c: Creation) {
    return (c.content as PackContent).puzzles;
  }
}
