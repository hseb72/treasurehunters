import { ageLabel, AUDIENCE_TAGS, AudienceTag, PRACTICAL_TAGS, PracticalTag, Setting, SETTINGS } from '@shared/practical';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, numberAttribute, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { filter, switchMap, take, takeWhile, timer } from 'rxjs';
import { priceLabel } from '@shared/store';
import { CatalogEntry, Challenge, ReportCategory } from '@shared/models';
import { REPORT_CATEGORIES } from '@shared/reports';
import { formatDuration, MEASURED_MIN } from '@shared/rules';
import { kmLabel } from '../../shared/distance';
import { Shop } from '../../core/shop';
import { DIFFICULTY_LABELS, minutesLabel, TRAVEL_HINTS, TRAVEL_ICONS, TRAVEL_LABELS } from '@shared/generation';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';
import { Confirm } from '../../shared/confirm-dialog';
import { DomTranslator } from '../../core/dom-translator';
import { Stars } from '../../shared/stars';
import { ListButton } from '../../shared/list-button';
import { Dare } from '../../shared/dare-dialog';

/** Fiche d'une version du catalogue : présentation, extrait, avis, versions, et copie. */
@Component({
  selector: 'th-catalog-entry',
  imports: [DatePipe, ListButton, MatButtonModule, MatIconModule, RouterLink, Stars],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-entry.html',
  styleUrl: './catalog-entry.scss',
})
export class CatalogEntryPage {
  /** Repères pratiques (§ 26). */
  protected readonly age = ageLabel;
  protected readonly km = kmLabel;
  /** Durée constatée, seulement quand assez d'équipes sont arrivées pour qu'elle dise vrai (§ 35). */
  protected measured(e: CatalogEntry): number | null {
    return e.measuredMinutes !== null && e.finishers >= MEASURED_MIN ? e.measuredMinutes : null;
  }
  protected readonly practicalOf = (ids: PracticalTag[]) => PRACTICAL_TAGS.filter((t) => ids.includes(t.id));
  /** « en famille, entre amis ou seul » (§ 36) ; null si l'auteur n'a rien précisé. */
  protected readonly audienceOf = (ids: AudienceTag[]): string | null => {
    const labels = AUDIENCE_TAGS.filter((t) => ids.includes(t.id)).map((t) => t.label.toLowerCase());
    return labels.length ? (labels.length > 1 ? `${labels.slice(0, -1).join(', ')} ou ${labels.at(-1)}` : labels[0]!) : null;
  };
  protected readonly settingOf = (id: Setting | null) => SETTINGS.find((t) => t.id === id) ?? null;
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  private readonly confirm = inject(Confirm);
  protected readonly session = inject(Session);

  readonly id = input.required({ transform: numberAttribute });
  /** « ?defi=12 » : un ami lance un défi « bats mon temps » avec sa partie (§ 28). */
  readonly defi = input<string | undefined>();
  private readonly dareDialog = inject(Dare);
  protected readonly challenge = rxResource({
    params: () => {
      const hunt = Number(this.defi());
      return Number.isInteger(hunt) && hunt > 0 ? { id: this.id(), hunt } : undefined;
    },
    stream: ({ params }) => this.api.getChallenge(params.id, params.hunt),
  });

  protected scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Défier un ami avec sa dernière partie finie : un mot, puis un lien vers la fiche avec son temps à battre (§ 39). */
  protected dare(): void {
    const e = this.entry.value();
    const last = this.finishedPlays()[0];
    if (e && last) this.dareDialog.open(e.id, last.huntId, e.title);
  }

  /** La partie du lecteur qui relève ce défi, s'il en a lancé une. */
  protected readonly myTake = (c: Challenge) => c.takers.find((t) => t.mine) ?? null;

  protected readonly entry = rxResource({
    params: () => ({ id: this.id(), user: this.session.user()?.id }),
    stream: ({ params }) => this.api.getCatalogEntry(params.id),
  });
  protected readonly busy = signal(false);
  /** Version anglaise (§ 33) : titre, présentation et extrait de la fiche. */
  private readonly i18n = inject(DomTranslator);
  private readonly translateContent = effect(() => {
    const e = this.entry.value();
    if (e) untracked(() => this.i18n.requestContent({ catalog: [e.id, ...e.versions.map((v) => v.id)].slice(0, 30) }));
  });
  protected readonly difficulty = DIFFICULTY_LABELS;
  protected readonly travel = TRAVEL_LABELS;
  protected readonly travelHints = TRAVEL_HINTS;
  protected readonly icons = TRAVEL_ICONS;
  protected readonly minutes = minutesLabel;
  protected readonly isAuthor = computed(() => this.entry.value()?.authorId === this.session.user()?.id);

  protected reportLabel(c: ReportCategory): string {
    return REPORT_CATEGORIES.find((x) => x.id === c)?.label.toLowerCase() ?? c;
  }

  /* ---------- Jouer en autonomie (§ 13.5) ---------- */
  /** Jouable sans organisateur : validée par géolocalisation, pas de QR à poser. */
  protected readonly autonomous = computed(() => {
    const e = this.entry.value();
    return !!e && !e.withdrawn && e.validation === 'geo';
  });
  protected readonly waitingPlay = computed(() => this.entry.value()?.myPlays.find((p) => !p.started && Date.parse(p.until) > Date.now()) ?? null);
  protected readonly runningPlay = computed(() => this.entry.value()?.myPlays.find((p) => p.started && !p.finished) ?? null);
  protected readonly finishedPlays = computed(() => this.entry.value()?.myPlays.filter((p) => p.finished) ?? []);
  protected readonly board = rxResource({
    params: () => (this.autonomous() ? { id: this.id(), user: this.session.user()?.id } : undefined),
    stream: ({ params }) => this.api.autonomyLeaderboard(params.id),
  });
  /** Les dix premiers, et la meilleure place du lecteur s'il est plus loin. */
  protected readonly shownRows = computed(() => {
    const rows = this.board.value()?.rows ?? [];
    const top = rows.slice(0, 10);
    const mine = rows.find((r) => r.mine);
    return mine && !top.includes(mine) ? [...top, mine] : top;
  });
  protected readonly clock = (seconds: number) => formatDuration(seconds);

  /** La partie du joueur : créée (ou retrouvée), puis son carnet de route, où il lancera le départ sur place. */
  /** Venu par un lien de défi, le joueur le relève en jouant (§ 39). */
  protected play(challenge = this.challenge.value()?.huntId): void {
    if (!this.session.loggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.busy.set(true);
    this.api.playFromCatalog(this.id(), challenge).subscribe({
      next: (hunt) => {
        this.notify.info('Votre partie est prête : lancez le départ une fois au point de rendez-vous, aujourd’hui ou plus tard.', 6000);
        this.router.navigate(['/play', hunt.id]);
      },
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
    });
  }

  /* ---------- Chasse payante (§ 20) ---------- */
  private readonly shop = inject(Shop);
  protected readonly mustBuy = computed(() => {
    const e = this.entry.value();
    return !!e && this.shop.payments() && e.price > 0 && !e.owned && !this.isAuthor();
  });
  protected readonly price = (cents: number) => priceLabel({ price: cents, included: false });
  /** Retour de la page de paiement : « ?paid=1 » (ou 0 si annulé). */
  readonly paid = input<string | undefined>();

  constructor() {
    effect(() => {
      const paid = this.paid();
      if (paid === undefined) return;
      untracked(() => {
        this.router.navigate([], { queryParams: {}, replaceUrl: true });
        this.notify.info(paid === '1' ? 'Paiement reçu, merci ! La Secret Track est à vous : jouez-la ou organisez-la.' : 'Paiement annulé : rien n’a été débité.');
        // La confirmation de Stripe peut suivre de quelques secondes.
        if (paid === '1') timer(0, 2000).pipe(take(6), takeWhile(() => !this.entry.value()?.owned)).subscribe(() => this.entry.reload());
      });
    });
  }

  protected buy(): void {
    if (!this.session.loggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.busy.set(true);
    this.shop.obtain(`hunt:c${this.id()}`, `/catalog/${this.id()}`).subscribe({
      next: () => this.entry.reload(),
      error: (e) => {
        this.busy.set(false);
        this.notify.error(e);
      },
      // Payante : on part vers le paiement, ou on en revient (maquette) ; gratuite : déjà rechargée.
      complete: () => this.busy.set(false),
    });
  }
  protected readonly criteria = computed(() => {
    const r = this.entry.value()?.rating;
    return r
      ? [
          { label: 'Énigmes', value: r.riddles },
          { label: 'Parcours', value: r.route },
          { label: 'Ambiance', value: r.mood },
        ]
      : [];
  });

  /** Brouillon à partir de cette version : l'organisateur l'adapte ensuite librement. */
  protected copy(): void {
    if (!this.session.loggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.busy.set(true);
    this.api.copyFromCatalog(this.id()).subscribe({
      next: (hunt) => {
        this.notify.info('Votre Secret Track est créée en brouillon : adaptez-la, fixez les dates et imprimez vos QR codes.');
        this.router.navigate(['/organize', hunt.id, 'info']);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

  protected withdraw(): void {
    this.confirm
      .ask({
        title: 'Retirer cette version du catalogue ?',
        message: 'Elle n’apparaîtra plus dans le catalogue. Les Secret Tracks déjà copiées à partir d’elle ne changent pas.',
        confirm: 'Retirer',
        danger: true,
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.withdrawFromCatalog(this.id())),
      )
      .subscribe({
        next: (e) => {
          this.entry.set(e);
          this.notify.info('Version retirée du catalogue.');
        },
        error: (e) => this.notify.error(e),
      });
  }
}
