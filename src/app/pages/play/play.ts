import { TeamRoles } from '../../shared/team-roles';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, numberAttribute, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { filter, switchMap, timer } from 'rxjs';
import { CheckinResult, CompassReading, PlayClue, PhotoResult, PlayState, PlayStep } from '@shared/models';
import { ReadAloud } from '../../shared/read-aloud';
import { OfflinePlay } from './offline-play';
import { OfflineStore } from '../../core/offline-store';
import { DomTranslator } from '../../core/dom-translator';
import { HttpErrorResponse } from '@angular/common/http';
import { HuntApi } from '../../core/api';
import { currentPosition } from '../../core/geo';
import { compressPhoto } from '../../core/photo';
import { Clock } from '../../core/clock';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';
import { formatDuration } from '@shared/rules';
import { formatClock } from '../../shared/format';
import { Confirm } from '../../shared/confirm-dialog';
import { InvitePanel } from '../../shared/invite-panel';
import { StartPlace } from '../../shared/start-place';
import { Trail } from '../../shared/trail';
import { TrailMap } from '../../shared/trail-map';
import { PuzzleCard } from '../../shared/puzzle-card';
import { PlacePhoto } from '../../shared/place-photo';
import { ReportProblem } from '../../shared/report-dialog';
import { LatLng } from '../../shared/location-map';
import { NearbyPanel } from '../../shared/nearby-panel';
import { GuideHandoff } from '../../core/guide-handoff';

/** Rafraîchissement pour voir les scans des équipiers. */
const REFRESH_MS = 15_000;

import { SkinDirective, SkinEffects } from '../../shared/skin';

@Component({
  selector: 'th-play',
  imports: [OfflinePlay, ReadAloud, SkinDirective, DatePipe, InvitePanel, TeamRoles, MatButtonModule, MatIconModule, RouterLink, PuzzleCard, PlacePhoto, StartPlace, Trail, TrailMap, NearbyPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './play.html',
  styleUrls: ['./play.scss', './play-tools.scss'],
})
export class PlayPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly clock = inject(Clock);
  private readonly confirm = inject(Confirm);
  private readonly session = inject(Session);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly state = rxResource({
    params: () => this.id(),
    stream: ({ params }) => timer(0, REFRESH_MS).pipe(switchMap(() => this.api.getPlay(params))),
  });
  /** Centres d'intérêt dits au guide (§ 46) : enregistrés pour l'équipe à l'ouverture de la partie. */
  private readonly handoff = inject(GuideHandoff);
  private readonly applyGuide = effect(() => {
    const hunt = this.state.value()?.hunt;
    if (hunt) untracked(() => this.handoff.apply(hunt));
  });

  /** Skin de la chasse, dès qu'elle est connue. */
  protected readonly skin = computed(() => this.state.value()?.hunt.skin);
  protected readonly fx = inject(SkinEffects);

  /** Ce que lit « Écouter » (§ 27) : l'énigme, puis les jokers déjà ouverts. */
  protected spoken(clue: PlayClue): string {
    return [clue.instructions, ...clue.hintsRevealed.map((h, i) => `Joker ${i + 1} : ${h}`)].join('\n\n');
  }
  protected readonly fxClass = computed(() => this.fx.validateClass(this.skin()));

  /* ---------- Énigme d'arrivée (§ 17) ---------- */

  protected solvePuzzle(answer: string): void {
    this.busy.set(true);
    this.api.solvePuzzle(this.id(), answer).subscribe({
      next: (r) => {
        this.state.set(r.state);
        this.busy.set(false);
        if (r.correct && r.step) {
          // Même annonce qu'une arrivée validée : tampon, message d'arrivée, son.
          this.checkin.set({ outcome: 'validated', distance: 0, allowed: 0, step: r.step, state: r.state });
          this.celebrate(r.step.isFinal);
        }
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

  protected puzzleHint(): void {
    this.busy.set(true);
    this.api.puzzleHint(this.id()).subscribe({
      next: (s) => {
        this.state.set(s);
        this.fx.hint(this.skin());
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

  /* ---------- Barre d'outils (§ 16) ---------- */

  protected readonly sheet = signal<'map' | 'compass' | 'nearby' | 'team' | null>(null);
  protected readonly sheetTitles = { map: 'Carte du parcours', compass: 'Boussole', nearby: 'Autour de moi', team: 'Mon équipe' } as const;
  protected readonly me = signal<LatLng | null>(null);
  protected readonly locatingMe = signal(false);
  protected readonly reading = signal<CompassReading | null>(null);
  protected readonly compassBusy = signal(false);

  protected openSheet(kind: 'map' | 'compass' | 'nearby' | 'team'): void {
    this.sheet.set(this.sheet() === kind ? null : kind);
    if (this.sheet() === 'compass') this.useCompass();
  }

  protected showClue(): void {
    this.sheet.set(null);
    document.querySelector('.clue')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected async locateMe(): Promise<void> {
    this.locatingMe.set(true);
    try {
      const p = await currentPosition();
      this.me.set({ lat: p.lat, lng: p.lng });
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.locatingMe.set(false);
    }
  }

  /** La boussole : direction et fourchette de distance, depuis la position du téléphone. */
  protected async useCompass(): Promise<void> {
    this.compassBusy.set(true);
    try {
      const p = await currentPosition();
      this.api.compass(this.id(), { lat: p.lat, lng: p.lng }).subscribe({
        next: (r) => {
          this.reading.set(r);
          this.compassBusy.set(false);
        },
        error: (e) => {
          this.notify.error(e);
          this.compassBusy.set(false);
        },
      });
    } catch (e) {
      this.notify.error(e);
      this.compassBusy.set(false);
    }
  }

  /** Son et animation d'une étape validée ; fanfare et confettis pour le trésor. */
  private celebrate(isFinal: boolean): void {
    if (isFinal) this.fx.treasure(this.skin());
    else this.fx.validated(this.skin());
  }

  /** Premier appui sur un joker = demande de confirmation. */
  protected readonly confirmHint = signal(false);
  protected readonly busy = signal(false);
  /** Recherche de la position en cours (« Je suis arrivé »). */
  protected readonly locating = signal(false);
  /** Dernier « Je suis arrivé » : lieu trouvé, ou distance restante. */
  protected readonly checkin = signal<CheckinResult | null>(null);
  /** Preuve par photo : dernier envoi (avis de l'IA) et son aperçu local. */
  protected readonly photo = signal<PhotoResult | null>(null);
  protected readonly photoPreview = signal<string | null>(null);
  protected readonly sending = signal(false);

  /** Phase de jeu de l'équipe. */
  /* ---------- Version anglaise (§ 33) ---------- */

  private readonly i18n = inject(DomTranslator);
  /** Le contenu visible de la partie (énigme, jokers, lieux trouvés) est traduit à chaque changement. */
  private readonly translateContent = effect(() => {
    const s = this.state.value();
    if (!s) return;
    const key = `${s.validated.length}:${s.clue?.targetOrder}:${s.hintsUsed}:${s.puzzle?.stepId ?? ''}`;
    untracked(() => {
      if (key === this.translatedKey) return;
      this.translatedKey = key;
      this.i18n.requestContent({ hunt: this.id() });
    });
  });
  private translatedKey = '';

  /* ---------- Hors ligne (§ 32) ---------- */

  protected readonly offline = inject(OfflineStore);
  protected readonly offlineEntry = computed(() => this.offline.get(this.id()));
  protected readonly offlineBusy = signal(false);
  /** Sans réseau (ou serveur injoignable), le carnet continue sur le paquet enregistré. */
  protected readonly offlineMode = computed(() => {
    const entry = this.offlineEntry();
    if (!entry) return false;
    const err = this.state.error();
    return !this.offline.online() || (err instanceof HttpErrorResponse && err.status === 0) || entry.events.length > 0;
  });
  /** Retour du réseau, tout synchronisé : le carnet en ligne reprend. */
  private pendingBefore = 0;
  private readonly resumeOnline = effect(() => {
    const pending = this.offlineEntry()?.events.length ?? 0;
    const synced = this.pendingBefore > 0 && pending === 0;
    this.pendingBefore = pending;
    if (this.offline.online() && !pending && (synced || this.state.error())) untracked(() => this.state.reload());
  });
  /** Paquet enregistré : tenu à jour de ce qui se passe en ligne (étapes, jokers). */
  private readonly refreshOffline = effect(() => {
    const s = this.state.value();
    const entry = this.offlineEntry();
    if (!s || !entry || entry.events.length || !this.offline.online()) return;
    const hints = Object.values(entry.progress.hints).reduce((a, n) => a + n, 0);
    const stale = entry.progress.validated.length !== s.validated.length || hints !== s.hintsUsed || entry.progress.started !== s.team.started;
    if (stale && ['before', 'waiting', 'playing'].includes(untracked(() => this.phase()))) untracked(() => void this.offline.prepare(this.id()).catch(() => undefined));
  });
  /** Le paquet se prépare une fois inscrit, avant l'arrivée. */
  protected readonly offlineReady = computed(() => ['before', 'waiting', 'playing'].includes(this.phase()));

  protected async prepareOffline(): Promise<void> {
    this.offlineBusy.set(true);
    try {
      await this.offline.prepare(this.id());
      this.notify.info('Parcours enregistré : vous pouvez jouer sans réseau.');
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.offlineBusy.set(false);
    }
  }

  protected readonly phase = computed(() => {
    const s = this.state.value();
    if (!s) return 'loading';
    if (s.team.finished) return 'finished';
    if (s.team.abandoned) return 'abandoned';
    // Chasse surprise « chacun son chrono » : la course a pu partir sans notre équipe.
    if (s.hunt.status === 'published' || s.selfStart) return 'before';
    if (s.hunt.status !== 'running') return 'over';
    if (!s.team.started || Date.parse(s.team.started) > this.clock.now()) return 'waiting';
    return 'playing';
  });

  /** Arrivée par abandon du trésor : le parcours est fini, sans trésor trouvé. */
  protected readonly treasureSkipped = computed(() => {
    const s = this.state.value();
    return !!s?.team.finished && !!s.validated.find((v) => v.order === s.totalSteps)?.skipped;
  });

  protected readonly skippedOrders = computed(() => (this.state.value()?.validated ?? []).filter((v) => v.skipped).map((v) => v.order));

  protected readonly chrono = computed(() => {
    const s = this.state.value();
    if (!s?.team.started) return '';
    const end = s.team.finished ? Date.parse(s.team.finished) : this.clock.now();
    return formatClock(end - Date.parse(s.team.started));
  });

  protected readonly finalTime = computed(() => {
    const s = this.state.value();
    if (!s?.team.finished || !s.team.started) return '';
    const seconds = (Date.parse(s.team.finished) - Date.parse(s.team.started)) / 1000;
    return formatDuration(seconds + s.penalty * 60);
  });

  /** Pénalité du prochain joker de l'énigme en cours, en minutes. */
  protected readonly nextHintPenalty = computed(() => {
    const s = this.state.value();
    return s?.clue ? (s.hunt.hintPenalties[s.clue.hintsRevealed.length] ?? 0) : 0;
  });

  /** Chasse surprise : le joueur l'a créée, il choisit le mode de départ tant que rien n'est parti. */
  protected readonly isHost = computed(() => {
    const s = this.state.value();
    return !!s?.hunt.surprise && s.hunt.hostId === this.session.user()?.id;
  });

  /** Chasse surprise encore ouverte aux inscriptions : on peut inviter pendant la course. */
  protected readonly invitesOpen = computed(() => {
    const h = this.state.value()?.hunt;
    return !!h?.surprise && (h.status === 'published' || (h.selfPaced && h.status === 'running'));
  });

  protected setSelfPaced(selfPaced: boolean): void {
    this.busy.set(true);
    this.api.setSelfPaced(this.id(), selfPaced).subscribe({
      next: () => {
        this.state.reload();
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

  protected countdown(iso: string | null): string {
    return iso ? formatClock(Date.parse(iso) - this.clock.now()) : '';
  }

  /** Abandon de l'épreuve en cours (« 4ᵉ joker »), après confirmation. */
  protected skip(targetOrder: number): void {
    const penalty = this.state.value()?.hunt.skipPenalty ?? 0;
    const final = targetOrder === this.state.value()?.totalSteps;
    this.confirm
      .ask({
        title: final ? 'Abandonner le trésor ?' : `Abandonner l’épreuve ${targetOrder} ?`,
        message:
          (penalty ? `Votre équipe prendra ${penalty} min de pénalité. ` : '') +
          (final
            ? 'Votre parcours s’arrête ici, sans le trésor : votre équipe sera classée après celles qui l’ont trouvé. Ce choix est définitif.'
            : 'L’énigme suivante s’affichera aussitôt, sans que vous ayez trouvé ce lieu. Ce choix est définitif.'),
        confirm: final ? 'Abandonner le trésor' : 'Abandonner',
        danger: true,
      })
      .pipe(
        filter(Boolean),
        switchMap(() => {
          this.busy.set(true);
          return this.api.skipStep(this.id());
        }),
      )
      .subscribe({
        next: (s) => {
          this.state.set(s);
          this.confirmHint.set(false);
          this.checkin.set(null);
          this.busy.set(false);
          // Le lieu manqué est dévoilé, avec sa photo ; l'arrivée a son propre écran.
          if (!final) this.revealed.set(s.validated.find((v) => v.order === targetOrder) ?? null);
          this.notify.info(final ? 'Parcours terminé, sans le trésor.' : 'Épreuve abandonnée : place à l’énigme suivante.');
        },
        error: (e) => {
          this.notify.error(e);
          this.busy.set(false);
        },
      });
  }

  /** Abandon de la partie (§ 5.2) : toute l'équipe s'arrête, sans classement. */
  protected abandonGame(): void {
    const s = this.state.value();
    if (!s) return;
    const team = s.team.members.length > 1;
    this.confirm
      .ask({
        title: 'Abandonner la partie ?',
        message:
          (team ? `Toute l’équipe « ${s.team.name} » s’arrête avec vous. ` : '') +
          'Le chrono s’arrête, plus aucune énigme ne s’affichera et vous ne serez pas classé. Ce choix est définitif.',
        confirm: 'Abandonner la partie',
        danger: true,
      })
      .pipe(
        filter(Boolean),
        switchMap(() => {
          this.busy.set(true);
          return this.api.abandonHunt(this.id());
        }),
      )
      .subscribe({
        next: (state) => {
          this.state.set(state);
          this.busy.set(false);
          this.notify.info('Partie abandonnée.');
        },
        error: (e) => {
          this.notify.error(e);
          this.busy.set(false);
        },
      });
  }

  /** Chasse surprise : le joueur donne le départ (de son équipe, ou de tous en départ commun). */
  protected go(): void {
    this.busy.set(true);
    this.api.selfStart(this.id()).subscribe({
      next: (s) => {
        this.state.set(s);
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }

  /** « Je suis arrivé » : la position du téléphone valide l'étape cherchée si elle est assez proche. */
  protected async arrived(): Promise<void> {
    this.locating.set(true);
    this.checkin.set(null);
    try {
      const pos = await currentPosition();
      this.api.checkin(this.id(), pos).subscribe({
        next: (r) => {
          this.checkin.set(r);
          this.state.set(r.state);
          if (r.outcome === 'validated') this.celebrate(!!r.step?.isFinal);
          this.confirmHint.set(false);
          this.locating.set(false);
        },
        error: (e) => {
          this.notify.error(e);
          this.locating.set(false);
        },
      });
    } catch (e) {
      this.notify.error(e);
      this.locating.set(false);
    }
  }

  /** QR introuvable : la photo du lieu est jugée par l'IA ; si elle la reconnaît, l'étape est validée. */
  protected async sendPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // pour pouvoir reprendre la même photo
    if (!file) return;
    this.sending.set(true);
    this.photo.set(null);
    this.checkin.set(null);
    try {
      const image = await compressPhoto(file);
      this.photoPreview.set(image);
      this.api.submitPhoto(this.id(), image).subscribe({
        next: (r) => {
          this.photo.set(r);
          this.state.set(r.state);
          if (r.photo.review) this.celebrate(r.photo.stepOrder === r.state.totalSteps);
          this.confirmHint.set(false);
          this.sending.set(false);
        },
        error: (e) => {
          this.notify.error(e);
          this.sending.set(false);
        },
      });
    } catch (e) {
      this.notify.error(e);
      this.sending.set(false);
    }
  }

  /** L'équipe confirme une photo non reconnue : validée tout de suite, contrôlée par l'organisateur. */
  protected insist(): void {
    const r = this.photo();
    if (!r) return;
    const isFinal = r.photo.stepOrder === r.state.totalSteps;
    const penalty = r.state.hunt.skipPenalty;
    this.confirm
      .ask({
        title: 'Confirmer cette photo ?',
        message:
          'L’étape sera validée tout de suite et l’organisateur contrôlera la photo. ' +
          (isFinal
            ? 'S’il la refuse, votre arrivée ne comptera pas et votre équipe ne sera pas classée.'
            : `S’il la refuse, l’épreuve comptera comme abandonnée${penalty ? ` (+${penalty} min de pénalité)` : ''}.`),
        confirm: 'J’insiste',
      })
      .pipe(
        filter(Boolean),
        switchMap(() => {
          this.busy.set(true);
          return this.api.insistPhoto(r.photo.id);
        }),
      )
      .subscribe({
        next: (res) => {
          this.photo.set(res);
          this.state.set(res.state);
          this.celebrate(res.photo.stepOrder === res.state.totalSteps);
          this.busy.set(false);
        },
        error: (e) => {
          this.notify.error(e);
          this.busy.set(false);
        },
      });
  }

  /** Photo du lieu d'une étape que l'équipe vient de valider, si l'organisateur la montre. */
  /** Signaler un problème sur une étape (§ 22). */
  protected readonly report = inject(ReportProblem);

  /** Étape validée dont la photo peut être montrée (avec son crédit), ou null. */
  protected pictureOf(state: PlayState, order: number): PlayStep | null {
    const v = state.validated.find((x) => x.order === order);
    return v?.illustration ? v : null;
  }

  /** Lieu dévoilé après l'abandon d'une épreuve (§ 47) : son nom et sa photo. */
  protected readonly revealed = signal<PlayStep | null>(null);
  /** L'arrivée, avec sa photo : le trésor trouvé ou abandonné. */
  protected readonly treasure = computed(() => {
    const s = this.state.value();
    return s ? (s.validated.find((v) => v.order === s.totalSteps) ?? null) : null;
  });

  /** Étape validée par la dernière photo (titre et message d'arrivée). */
  protected readonly photoStep = computed(() => {
    const r = this.photo();
    return r ? (r.state.validated.find((v) => v.order === r.photo.stepOrder) ?? null) : null;
  });

  protected closePhoto(): void {
    this.photo.set(null);
    this.photoPreview.set(null);
  }

  protected revealHint(): void {
    if (!this.confirmHint()) {
      this.confirmHint.set(true);
      return;
    }
    this.busy.set(true);
    this.api.revealHint(this.id()).subscribe({
      next: (s) => {
        this.state.set(s);
        this.fx.hint(this.skin());
        this.confirmHint.set(false);
        this.busy.set(false);
      },
      error: (e) => {
        this.notify.error(e);
        this.busy.set(false);
      },
    });
  }
}
