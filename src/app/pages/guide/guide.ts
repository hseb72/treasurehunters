import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GUIDE_CATALOG_RADIUS, guideDurationWindow, GuideUnderstanding, rankProposals, spokenMinutes } from '@shared/guide';
import { DIFFICULTY_LABELS, TRAVEL_ICONS, TRAVEL_LABELS } from '@shared/generation';
import { CatalogEntry, GenerationRequest } from '@shared/models';
import { DEFAULT_SKIN } from '@shared/skins';
import { HuntApi } from '../../core/api';
import { currentPosition } from '../../core/geo';
import { GuideHandoff } from '../../core/guide-handoff';
import { Voice } from '../../core/voice';
import { CatalogCard } from '../../shared/catalog-card';

type Step = 'idle' | 'listening' | 'thinking' | 'asking' | 'searching' | 'proposals' | 'confirm' | 'creating' | 'error';

/** Réponses dites au guide quand il propose le sur-mesure. */
const YES = /^\s*(oui|ouais|ok|okay|d'?accord|vas[- ]y|allez|go|c'est parti|volontiers|carr[ée]ment|bien s[uû]r|parfait|yes)\b/i;
const NO = /^\s*(non|nan|pas maintenant|plus tard|annule|laisse tomber|no)\b/i;

/**
 * Guide (§ 46) : le joueur dit ce qu'il souhaite ; le guide le comprend, cherche dans le
 * catalogue, et à défaut lance un parcours sur mesure. Tout ce qu'il dit s'affiche aussi.
 */
@Component({
  selector: 'th-guide',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, RouterLink, CatalogCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './guide.html',
  styleUrl: './guide.scss',
})
export class GuidePage {
  private readonly api = inject(HuntApi);
  private readonly router = inject(Router);
  private readonly handoff = inject(GuideHandoff);
  protected readonly voice = inject(Voice);

  protected readonly step = signal<Step>('idle');
  /** Demande du joueur : transcrite, ou écrite. */
  protected readonly text = signal('');
  /** Dernière phrase du guide, affichée et dite. */
  protected readonly said = signal('Bonjour ! Dites-moi avec qui vous êtes, combien de temps vous avez et ce dont vous avez envie.');
  protected readonly understood = signal<GuideUnderstanding | null>(null);
  protected readonly proposals = signal<CatalogEntry[]>([]);
  protected readonly error = signal<string | null>(null);
  /** Le guide parle : désactivé, il se contente d'écrire. */
  protected readonly muted = signal(false);

  protected readonly access = rxResource({ stream: () => this.api.generationAccess() });
  protected readonly canCreate = computed(() => !!this.access.value()?.right);

  protected readonly travelLabels = TRAVEL_LABELS;
  protected readonly travelIcons = TRAVEL_ICONS;
  protected readonly difficultyLabels = DIFFICULTY_LABELS;
  protected readonly spokenMinutes = spokenMinutes;
  protected readonly examples = [
    'On est en famille avec deux enfants, une balade cet après-midi avec une pause goûter.',
    'Deux heures à vélo entre amis, des énigmes corsées.',
    'Une heure à pied autour de moi, et je cherche une paire de sneakers.',
  ];

  private position: { lat: number; lng: number } | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.voice.stopListening();
      this.voice.stopSpeaking();
    });
  }

  private say(text: string): void {
    this.said.set(text);
    if (!this.muted()) this.voice.speak(text);
  }

  protected toggleMute(): void {
    this.muted.update((m) => !m);
    if (this.muted()) this.voice.stopSpeaking();
  }

  /** Micro : écoute, puis comprend. Un second appui termine la demande. */
  protected async talk(): Promise<void> {
    if (this.voice.listening()) {
      this.voice.stopListening();
      return;
    }
    // Arrêt demandé, fin de phrase attendue : un second appui ne relance pas d'écoute.
    if (this.step() === 'listening') return;
    const asking = this.step() === 'asking';
    const confirming = this.step() === 'confirm';
    this.error.set(null);
    this.step.set('listening');
    try {
      const heard = await this.voice.listen();
      if (!heard) {
        // Ne pas revenir en silence : le joueur doit savoir que rien n'a été transcrit.
        this.step.set(asking ? 'asking' : confirming ? 'confirm' : 'idle');
        this.say('Je n’ai rien entendu. Touchez le micro et parlez près du téléphone, ou écrivez votre demande.');
        return;
      }
      // Réponse à la proposition de sur-mesure : oui lance la génération, non l'écarte.
      if (confirming && YES.test(heard)) return void (await this.create());
      if (confirming && NO.test(heard)) {
        this.step.set('confirm');
        this.say('Entendu, je ne crée rien. Vous pouvez modifier votre demande ou chercher dans le catalogue.');
        return;
      }
      // Réponse à une question, ou précision après la proposition : elle complète la demande.
      this.text.set((asking || confirming) && this.text() ? `${this.text()} ${heard}` : heard);
      await this.understand();
    } catch (e) {
      this.fail((e as Error).message);
    }
  }

  protected async submitText(): Promise<void> {
    if (this.text().trim().length < 3) return;
    await this.understand();
  }

  protected useExample(text: string): void {
    this.text.set(text);
    void this.understand();
  }

  protected restart(): void {
    this.voice.stopSpeaking();
    this.step.set('idle');
    this.understood.set(null);
    this.proposals.set([]);
    this.error.set(null);
  }

  private async understand(): Promise<void> {
    this.step.set('thinking');
    this.said.set('Je réfléchis…');
    // La position sert si le joueur ne nomme pas de lieu ; un refus n'empêche rien.
    if (!this.position) this.position = await currentPosition().then((p) => ({ lat: p.lat, lng: p.lng })).catch(() => null);
    try {
      const u = await firstValueFrom(this.api.understand({ text: this.text().trim(), position: this.position }));
      this.understood.set(u);
      if (u.question) {
        this.step.set('asking');
        this.say(u.question);
        return;
      }
      await this.search(u);
    } catch (e) {
      this.fail((e as Error).message);
    }
  }

  /** Le catalogue d'abord : des Secret Tracks jouables en autonomie, près du lieu voulu. */
  private async search(u: GuideUnderstanding): Promise<void> {
    this.step.set('searching');
    this.say(`${u.summary} Je cherche dans le catalogue.`);
    const window = guideDurationWindow(u.playMinutes);
    const where = u.place ? { q: u.place } : this.position ? { near: this.position, radius: GUIDE_CATALOG_RADIUS[u.travel], sort: 'distance' as const } : {};
    try {
      const entries = await firstValueFrom(
        this.api.listCatalog({ ...where, travel: [u.travel], minDuration: window.min, maxDuration: window.max, autonomous: true }),
      );
      const best = rankProposals(entries, u);
      this.proposals.set(best);
      if (best.length) {
        this.step.set('proposals');
        this.say(best.length === 1 ? 'J’ai trouvé un parcours qui vous correspond.' : `J’ai trouvé ${best.length} parcours qui vous correspondent.`);
        return;
      }
    } catch {
      // Catalogue injoignable : le sur-mesure reste possible.
    }
    this.proposals.set([]);
    // Une génération consomme un droit et prend du temps : on la propose, on ne la lance pas.
    this.step.set('confirm');
    this.say(
      this.canCreate()
        ? 'Je n’ai trouvé aucun parcours dans le catalogue. Voulez-vous que je vous concocte un parcours sur mesure ? Dites oui, ou touchez le bouton.'
        : 'Je n’ai trouvé aucun parcours dans le catalogue. Vous pouvez créer un parcours sur mesure.',
    );
  }

  /** Les centres d'intérêt suivent la Secret Track choisie jusqu'à la partie. */
  protected remember(entry: CatalogEntry): void {
    this.voice.stopSpeaking();
    this.handoff.keep(this.understood()?.interests ?? [], entry.id);
  }

  protected choose(entry: CatalogEntry): void {
    this.remember(entry);
    void this.router.navigate(['/catalog', entry.id]);
  }

  /** Parcours sur mesure : la génération (§ 11), avec la durée une fois le temps réservé retiré. */
  protected async create(): Promise<void> {
    const u = this.understood();
    if (!u) return;
    this.step.set('creating');
    if (!this.canCreate()) {
      this.say('Je n’ai rien trouvé dans le catalogue. Vous pouvez créer un parcours sur mesure.');
      return;
    }
    this.say('Je vous concocte un parcours personnalisé.');
    const pos = this.position;
    const request: GenerationRequest = {
      location: u.place ? { query: u.place } : { lat: pos!.lat, lng: pos!.lng },
      durationMinutes: Math.min(360, Math.max(20, u.playMinutes)),
      travel: u.travel,
      difficulty: u.difficulty,
      theme: u.theme,
      steps: null,
      mode: 'play',
      skin: DEFAULT_SKIN,
      puzzles: [],
    };
    try {
      const job = await firstValueFrom(this.api.generateHunt(request));
      this.handoff.keep(u.interests, null);
      // L'écran d'attente de la génération prend le relais, puis ouvre le carnet de route.
      void this.router.navigate(['/generate'], { queryParams: { job: job.id } });
    } catch (e) {
      this.fail((e as Error).message);
    }
  }

  private fail(message: string): void {
    this.error.set(message);
    this.step.set('error');
    this.said.set(message);
  }
}
