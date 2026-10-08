import { inject, Injectable } from '@angular/core';
import { defer, delay, Observable, of, throwError } from 'rxjs';
import { ApiError, CatalogQuery, HuntAction, HuntApi, HuntScope } from '../api';
import { Creation, CreationInput, creationProductId, creationRef, CreatorPage } from '@shared/creations';
import { MockCreations } from './mock-creations';
import { PlayData, stepStats } from '@shared/step-stats';
import { creatorBonus, GENERATION_LIMITS, GenerationAccess, generationOffer, GenerationRight, pickRight } from '@shared/generation-access';
import { AssistAction, AssistPlan, AssistReply, AssistRequest, AssistSuggestion, AssistUsage, assistUsage } from '@shared/assist';
import {
  AuthResult,
  HuntStats,
  ReportCategory,
  StepReport,
  AutonomyLeaderboard,
  AutonomyRow,
  CheckoutResult,
  PayoutAccount,
  CatalogDetail,
  CatalogEntry,
  CatalogPublication,
  CheckinResult,
  Features,
  GenerationJob,
  GenerationRequest,
  Hunt,
  Hunter,
  LiveRow,
  OrganizerProfile,
  PhotoAttempt,
  PhotoResult,
  PhotoReview,
  PhotoCredit,
  PhotoProposal,
  PhotoShow,
  PlayClue,
  PlayState,
  RankingRow,
  Rating,
  RatingState,
  ScanResult,
  Step,
  Team,
  StoreItem,
  CompassReading,
  PuzzleResult,
  Souvenir,
  Challenge,
  ChallengeTaker,
  GameInProgress,
  Travel,
} from '@shared/models';
import { DEFAULT_SKIN, SkinManifest } from '@shared/skins';
import { compassReading, DEFAULT_TOOLS, owns, PRODUCTS, productById, TOOL_IDS } from '@shared/store';
import { acceptedAnswers, checkAnswer, publicPuzzle, Puzzle, puzzleProblem, puzzleType } from '@shared/puzzles';
import { demoPlan, plannedStepCount } from '@shared/generation';
import { sketchTrail } from '@shared/souvenir';
import { AudienceTag, PracticalTag, Setting } from '@shared/practical';
import { TeamRole } from '@shared/roles';
import { percent, sharedStepRatio, SIMILARITY_LIMIT } from '@shared/similarity';
import { NEARBY_CATEGORIES, NearbyCategory, NearbyPlace, NearbyResult } from '@shared/nearby';
import { demoUnderstanding, GUIDE_MAX_INTERESTS, GuideInterest, GuideRequest, GuideUnderstanding } from '@shared/guide';
import { GeoCheck, StepReliability, stepReliability } from '@shared/gps';
import { FAVORITE_NAME, LISTS_MAX, TrackList, TrackListDetail } from '@shared/lists';
import { pickSurprise, Surprise, SURPRISE_RADIUS, SurpriseQuery } from '@shared/surprise';
import { OfflineEvent, offlineHash, OfflinePack, OfflineSyncResult } from '@shared/offline';
import { ExplorerJournal, explorerJournal, HistoryEntry, historyEntry, JournalHunt } from '@shared/journal';
import {
  arrivalCheck,
  routeKm,
  computeRanking,
  distanceMeters,
  evaluateScan,
  finalOrder,
  lastValidatedOrder,
  penaltyMinutes,
  randomToken,
  teamPosition,
  teamStartTimes,
} from '@shared/rules';
import { Session } from '../session';

/** Dégradé d'exemple (aperçus des photos proposées dans la maquette). */
const mockGradient = (a: string, b: string) =>
  'data:image/svg+xml;base64,' +
  btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/></svg>`);
const MOCK_PROPOSALS: [string, string, string][] = [
  ['File:Place de la Comédie.jpg', '#264653', '#e9c46a'],
  ['File:Fontaine des Trois Grâces.jpg', '#6d597a', '#eaac8b'],
  ['File:Arc de triomphe Montpellier.jpg', '#2a9d8f', '#f4a261'],
];

/** Image d'exemple d'une photo importée par lien dans la maquette (un carré dégradé). */
const MOCK_LINKED_PHOTO =
  'data:image/svg+xml;base64,' +
  btoa('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g"><stop offset="0" stop-color="#2a9d8f"/><stop offset="1" stop-color="#e9c46a"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/></svg>');
import { buildFixtures, MockDb } from '@shared/fixtures';

const LATENCY_MS = 150;
/** Durée simulée d'une génération de chasse. */
const GENERATION_MS = 4000;
/** Compte « SecretTracks », organisateur des chasses surprises. */
const SYSTEM_ID = 999;
/** Lieu par défaut quand le lieu est donné par son nom (pas de géocodage en maquette). */
const MONTPELLIER = { lat: 43.6085, lng: 3.8795 };

/**
 * Back-end simulé en mémoire pour les maquettes. Il applique les règles de docs/conception.md
 * comme le ferait le serveur. Les données sont réinitialisées à chaque rechargement de page.
 */
@Injectable()
export class MockHuntApi extends HuntApi {
  private readonly session = inject(Session);
  private readonly db: MockDb = buildFixtures();
  private readonly jobs = new Map<string, GenerationJob & { readyAt: number; ownerId: number }>();
  /** Preuve par photo : images en « data URL », gardées en mémoire. */
  private readonly photos: MockPhoto[] = [];
  private readonly refPhotos = new Map<number, string>();
  /** Catalogue (§ 13) et avis (§ 14). */
  private readonly catalog: MockEntry[] = [];
  /** Favoris et listes (§ 38). */
  private readonly lists: MockList[] = [];
  /** Défis étendus (§ 39) : mot du lanceur par partie source, et partie source de chaque partie qui relève un défi. */
  private readonly challengeNotes = new Map<number, { authorId: number; message: string | null }>();
  private readonly challengeOf = new Map<number, number>();
  /** Fiabilité GPS (§ 42) : arrivées des joueurs et tests de l'auteur. */
  private readonly geoChecks: (GeoCheck & { stepId: number; huntId: number; order: number })[] = [];
  private readonly ratings: { huntId: number; hunterId: number; rating: Rating; at: string }[] = [];

  constructor() {
    super();
    this.seedCatalog();
    this.seedAutonomy();
    this.seedPlacePhotos();
    this.seedSession();
    // Une liste partagée de Camille, que seb a rejointe (§ 38).
    this.lists.push({ id: 1, ownerId: 2, name: 'Balades en famille', icon: 'family_restroom', favorite: false, code: 'FAMILLE2', members: [1], items: this.catalog.filter((e) => !e.withdrawn).map((e) => e.id).reverse() });
  }

  /**
   * Photos du lieu de la démo (§ 18) : un détail du boulodrome en tête de l'énigme qui y
   * mène, les rayonnages de la médiathèque à l'arrivée. Des dessins, faute de vraies photos.
   */
  private seedPlacePhotos(): void {
    const svg = (body: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${body}</svg>`)}`;
    const boule = (x: number, y: number, r: number) =>
      `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#m)"/><path d="M${x - r * 0.8} ${y - r * 0.2} q${r * 0.8} ${r * 0.5} ${r * 1.6} 0" stroke="#5b636b" stroke-width="2" fill="none"/>`;
    const gravel = Array.from({ length: 140 }, (_, i) => `<circle cx="${(i * 97) % 400}" cy="${120 + ((i * 53) % 180)}" r="${1 + (i % 3)}" fill="#b89d6e"/>`).join('');
    const boulodrome = svg(
      `<defs><radialGradient id="m" cx="35%" cy="30%"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".5" stop-color="#9aa3ab"/><stop offset="1" stop-color="#3f464d"/></radialGradient>` +
        `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fae5a"/><stop offset="1" stop-color="#4f7d38"/></linearGradient></defs>` +
        `<rect width="400" height="130" fill="url(#s)"/><rect y="110" width="400" height="190" fill="#d9c49a"/>${gravel}` +
        `<ellipse cx="200" cy="262" rx="140" ry="14" fill="#000" opacity=".12"/>${boule(130, 225, 34)}${boule(215, 238, 30)}${boule(290, 214, 27)}` +
        `<circle cx="250" cy="180" r="9" fill="#c0392b"/><circle cx="247" cy="177" r="3" fill="#e8806f"/>`,
    );
    const colors = ['#8e3b2e', '#2f5d7c', '#c49a3a', '#4b7a47', '#6d4c7d', '#b5602f', '#2e6f6a', '#9c2f4f'];
    const shelf = (y: number, seed: number) =>
      `<rect x="20" y="${y + 70}" width="360" height="10" fill="#7a5230"/>` +
      Array.from({ length: 16 }, (_, i) => {
        const h = 50 + ((i * 7 + seed) % 20);
        return `<rect x="${26 + i * 22}" y="${y + 70 - h}" width="19" height="${h}" rx="2" fill="${colors[(i + seed) % colors.length]}"/><rect x="${30 + i * 22}" y="${y + 80 - h}" width="11" height="3" fill="#f3e6c8" opacity=".7"/>`;
      }).join('');
    const mediatheque = svg(`<rect width="400" height="300" fill="#efe4cf"/>${shelf(0, 1)}${shelf(95, 4)}${shelf(190, 6)}`);
    for (const [order, image, show] of [
      [3, boulodrome, 'clue'],
      [2, mediatheque, 'arrival'],
      // Le départ : couverture des cartes (§ 49).
      [0, mediatheque, null],
    ] as const) {
      const step = this.db.steps.find((s) => s.huntId === 1 && s.order === order);
      if (!step) continue;
      this.refPhotos.set(step.id, image);
      step.referencePhoto = true;
      step.photoShow = show;
      // Une photo libre, avec le crédit que sa licence exige (§ 47).
      if (order === 3) step.photoCredit = { text: 'Photo : Jean Dupont · CC BY-SA 4.0 · Wikimedia Commons', url: 'https://commons.wikimedia.org/' };
    }
  }

  logout(): Observable<void> {
    return this.reply(() => undefined);
  }

  /* ---------- Comptes ---------- */

  login(email: string, password: string): Observable<AuthResult> {
    return this.reply(() => {
      const h = this.db.hunters.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!h || h.password !== password) throw new ApiError('E-mail ou mot de passe incorrect.');
      return { user: this.publicHunter(h), token: `mock-${h.id}` };
    });
  }

  register(nickname: string, email: string, password: string): Observable<AuthResult> {
    return this.reply(() => {
      if (this.db.hunters.some((h) => h.email.toLowerCase() === email.toLowerCase())) throw new ApiError('Cet e-mail est déjà utilisé.');
      if (this.db.hunters.some((h) => h.nickname.toLowerCase() === nickname.toLowerCase())) throw new ApiError('Ce pseudo est déjà pris.');
      const h = { id: this.nextId(this.db.hunters), nickname, email, password, rateable: false };
      this.db.hunters.push(h);
      return { user: this.publicHunter(h), token: `mock-${h.id}` };
    });
  }

  updateMe(data: Partial<Pick<Hunter, 'nickname' | 'email' | 'rateable'>>): Observable<Hunter> {
    return this.reply(() => {
      const me = this.db.hunters.find((h) => h.id === this.requireUser())!;
      Object.assign(me, data);
      this.db.teams.forEach((t) => t.members.forEach((m) => m.hunterId === me.id && (m.nickname = me.nickname)));
      return this.publicHunter(me);
    });
  }

  /* ---------- Chasses ---------- */

  listHunts(scope: HuntScope): Observable<Hunt[]> {
    return this.reply(() => {
      const me = this.viewer();
      let list = this.db.hunts;
      if (scope === 'public') list = list.filter((h) => h.isPublic && ['published', 'running', 'closed'].includes(h.status));
      if (scope === 'playing') list = list.filter((h) => this.teamOf(h.id, me) !== null);
      if (scope === 'organized') list = list.filter((h) => h.ownerId === me);
      return list.map((h) => this.huntView(h)).sort((a, b) => a.begin.localeCompare(b.begin));
    });
  }

  getHunt(id: number): Observable<Hunt> {
    return this.reply(() => this.huntView(this.visibleHunt(id)));
  }

  findHuntByCode(code: string): Observable<Hunt> {
    return this.reply(() => {
      const h = this.db.hunts.find((x) => x.joinCode.toUpperCase() === code.trim().toUpperCase() && x.status !== 'draft');
      if (h) return this.huntView(h);
      const team = this.db.teams.find((t) => t.joinCode.toUpperCase() === code.trim().toUpperCase());
      if (team) return this.huntView(this.visibleHunt(team.huntId));
      throw new ApiError('Aucune Secret Track ni équipe ne correspond à ce code.');
    });
  }

  saveHunt(data: Partial<Hunt>): Observable<Hunt> {
    return this.reply(() => {
      const me = this.requireUser();
      if (data.id) {
        const h = this.ownedHunt(data.id);
        this.checkExtensions(me, data, h);
        const { id, ownerId, status, started, closed, hostId, hostNickname, selfPaced, catalogId, ...editable } = data;
        Object.assign(h, editable);
        return this.huntView(h);
      }
      this.checkExtensions(me, data, null);
      const id = this.nextId(this.db.hunts);
      const h: MockDb['hunts'][number] = {
        name: 'Nouvelle Secret Track',
        description: '',
        location: '',
        begin: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        end: new Date(Date.now() + 7 * 86_400_000 + 3 * 3_600_000).toISOString(),
        autoStart: false,
        autoClose: false,
        award: null,
        startMode: 'mass',
        interval: null,
        hintPenalties: [0, 0, 0],
        skipPenalty: 30,
        validation: 'qr',
        geoRadius: 40,
        teamGame: true,
        teamMin: 1,
        teamMax: 4,
        isPublic: true,
        contribution: 0,
        startText: null,
        travel: 'walk',
        skin: DEFAULT_SKIN,
        tools: [...DEFAULT_TOOLS],
        difficulty: null,
        durationMinutes: null,
        ...data,
        generated: false,
        surprise: false,
        hostId: null,
        selfPaced: true,
        catalogId: null,
        id,
        ownerId: me,
        joinCode: randomToken(6).toUpperCase(),
        status: 'draft',
        started: null,
        closed: null,
      };
      this.db.hunts.push(h);
      // Toute chasse commence avec un départ et une arrivée.
      this.db.steps.push(this.blankStep(id, 0, 'Départ'));
      this.db.steps.push(this.blankStep(id, 1, 'Arrivée'));
      return this.huntView(h);
    });
  }

  huntAction(id: number, action: HuntAction): Observable<Hunt> {
    return this.reply(() => {
      const h = this.ownedHunt(id);
      const now = new Date().toISOString();
      const expect = (...statuses: Hunt['status'][]) => {
        if (!statuses.includes(h.status)) throw new ApiError('Action impossible dans l’état actuel de la Secret Track.');
      };
      switch (action) {
        case 'publish':
          expect('draft');
          if (finalOrder(this.stepsOf(id)) < 1) throw new ApiError('Ajoutez au moins une étape avant d’ouvrir les inscriptions.');
          if (h.validation === 'geo') {
            const missing = this.stepsOf(id).find((s) => s.order > 0 && (s.latitude === null || s.longitude === null));
            if (missing) throw new ApiError(`Validation par géolocalisation : placez sur la carte « ${missing.title} ».`);
          }
          h.status = 'published';
          break;
        case 'unpublish':
          expect('published');
          if (this.db.teams.some((t) => t.huntId === id)) throw new ApiError('Des équipes sont déjà inscrites.');
          h.status = 'draft';
          break;
        case 'start':
          expect('published');
          this.start(h);
          break;
        case 'close':
          expect('running');
          h.status = 'closed';
          h.closed = now;
          break;
        case 'cancel':
          expect('draft', 'published', 'running');
          h.status = 'cancelled';
          break;
      }
      return this.huntView(h);
    });
  }

  /* ---------- Étapes ---------- */

  getSteps(huntId: number): Observable<Step[]> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      return this.stepsOf(huntId);
    });
  }

  saveStep(step: Partial<Step> & { huntId: number }): Observable<Step> {
    return this.reply(() => {
      this.ownedHunt(step.huntId);
      if (step.id) {
        const s = this.db.steps.find((x) => x.id === step.id && x.huntId === step.huntId);
        if (!s) throw new ApiError('Étape introuvable.');
        const { id, huntId, order, token, entrances, ...editable } = step;
        if (editable.puzzle) {
          if (s.order === 0) throw new ApiError('Le départ n’a pas d’énigme d’arrivée.');
          const problem = puzzleProblem(editable.puzzle);
          if (problem) throw new ApiError(problem);
          const pack = puzzleType(editable.puzzle.type).pack;
          const owned = this.purchases.get(this.requireUser()) ?? new Set<string>();
          // Une énigme tirée d'un pack de créateur obtenu (§ 19) se pose sans le pack de son type.
          if (s.puzzle?.type !== editable.puzzle.type && !owns(owned, pack) && !this.creations.fromOwnedPack(owned, editable.puzzle)) {
            throw new ApiError(`« ${puzzleType(editable.puzzle.type).name} » vient du pack « ${productById(pack)!.name} » : obtenez-le d’abord dans la boutique.`);
          }
        }
        // Déplacer l'étape, c'est changer de lieu : les entrées de l'ancien ne valent plus.
        const moved = (editable.latitude !== undefined && editable.latitude !== s.latitude) || (editable.longitude !== undefined && editable.longitude !== s.longitude);
        Object.assign(s, editable, moved ? { entrances: [] } : {});
        return s;
      }
      // Une nouvelle étape s'insère juste avant l'arrivée.
      const steps = this.stepsOf(step.huntId);
      const arrival = steps[steps.length - 1];
      const s: Step = { ...this.blankStep(step.huntId, arrival.order, `Étape ${arrival.order}`), ...step };
      s.order = arrival.order;
      arrival.order++;
      this.db.steps.push(s);
      return s;
    });
  }

  deleteStep(id: number): Observable<void> {
    return this.reply(() => {
      const s = this.db.steps.find((x) => x.id === id);
      if (!s) throw new ApiError('Étape introuvable.');
      this.ownedHunt(s.huntId);
      const final = finalOrder(this.stepsOf(s.huntId));
      if (s.order === 0 || s.order === final) throw new ApiError('Le départ et l’arrivée ne peuvent pas être supprimés.');
      this.db.steps = this.db.steps.filter((x) => x.id !== id);
      this.stepsOf(s.huntId).forEach((x, i) => (x.order = i));
    });
  }

  reorderSteps(huntId: number, stepIds: number[]): Observable<Step[]> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      const steps = this.stepsOf(huntId);
      const middle = steps.slice(1, -1);
      if (stepIds.length !== middle.length || !middle.every((s) => stepIds.includes(s.id))) {
        throw new ApiError('Liste d’étapes invalide.');
      }
      stepIds.forEach((sid, i) => (this.db.steps.find((s) => s.id === sid)!.order = i + 1));
      steps[steps.length - 1].order = stepIds.length + 1;
      return this.stepsOf(huntId);
    });
  }

  regenerateToken(stepId: number): Observable<Step> {
    return this.reply(() => {
      const s = this.db.steps.find((x) => x.id === stepId);
      if (!s || s.order === 0) throw new ApiError('Étape introuvable.');
      this.ownedHunt(s.huntId);
      s.token = randomToken();
      return s;
    });
  }

  /* ---------- Équipes ---------- */

  getTeams(huntId: number): Observable<Team[]> {
    return this.reply(() => {
      this.visibleHunt(huntId);
      return this.db.teams.filter((t) => t.huntId === huntId).sort((a, b) => (a.startOrder ?? 999) - (b.startOrder ?? 999) || a.id - b.id);
    });
  }

  myTeam(huntId: number): Observable<Team | null> {
    return this.reply(() => this.teamOf(huntId, this.viewer()));
  }

  createTeam(huntId: number, name: string): Observable<Team> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.joinableHunt(huntId, me);
      if (!h.teamGame) throw new ApiError('Cette Secret Track se joue en solo.');
      if (this.db.teams.some((t) => t.huntId === huntId && t.name.toLowerCase() === name.trim().toLowerCase())) {
        throw new ApiError('Une équipe porte déjà ce nom.');
      }
      return this.addTeam(h, name.trim(), me, false);
    });
  }

  joinTeam(code: string): Observable<Team> {
    return this.reply(() => {
      const me = this.requireUser();
      const team = this.db.teams.find((t) => t.joinCode.toUpperCase() === code.trim().toUpperCase());
      if (!team) throw new ApiError('Code d’équipe inconnu.');
      const h = this.joinableHunt(team.huntId, me);
      if (team.members.length >= h.teamMax) throw new ApiError('Cette équipe est complète.');
      if (team.finished) throw new ApiError('Cette équipe a déjà terminé l’expédition.');
      team.members.push({ hunterId: me, nickname: this.nick(me) });
      return team;
    });
  }

  /* ---------- Mode test (§ 42), comme le serveur ---------- */

  testStep(stepId: number, pos: { lat: number; lng: number; accuracy: number }): Observable<{ distance: number; allowed: number; ok: boolean }> {
    return this.reply(() => {
      const me = this.requireUser();
      const step = this.db.steps.find((x) => x.id === stepId);
      const h = step && this.db.hunts.find((x) => x.id === step.huntId && x.ownerId === me);
      if (!step || !h) throw new ApiError('Réservé à l’organisateur de la Secret Track.');
      const check = arrivalCheck(step, h, pos);
      if (!check) throw new ApiError('Ce lieu n’est pas placé sur la carte.');
      this.geoChecks.push({ stepId, huntId: h.id, order: step.order, ok: check.ok, distance: check.distance, accuracy: pos.accuracy, source: 'test' });
      return { distance: check.distance, allowed: check.allowed, ok: check.ok };
    });
  }

  gpsReliability(huntId: number): Observable<StepReliability[]> {
    return this.reply(() => {
      const me = this.requireUser();
      if (!this.db.hunts.some((x) => x.id === huntId && x.ownerId === me)) throw new ApiError('Réservé à l’organisateur de la Secret Track.');
      // Parties en autonomie de ses versions : même parcours, mêmes numéros d'étape.
      const versions = new Set(this.catalog.filter((e) => e.huntId === huntId).map((e) => e.id));
      const related = new Set([huntId, ...this.db.hunts.filter((x) => x.surprise && x.hostId !== null && x.catalogId !== null && versions.has(x.catalogId)).map((x) => x.id)]);
      return this.stepsOf(huntId)
        .filter((st) => st.order > 0 && st.latitude !== null)
        .map((st) => stepReliability(st, this.geoChecks.filter((c) => related.has(c.huntId) && c.order === st.order)));
    });
  }

  /** Rôles dans l'équipe (§ 41), comme le serveur. */
  setRole(teamId: number, role: TeamRole | null, hunterId?: number): Observable<Team> {
    return this.reply(() => {
      const me = this.requireUser();
      const team = this.db.teams.find((t) => t.id === teamId && t.members.some((m) => m.hunterId === me));
      if (!team) throw new ApiError('Équipe introuvable.');
      const target = hunterId ?? me;
      if (target !== me && team.ownerId !== me) throw new ApiError('Seul le créateur de l’équipe répartit les rôles des autres.');
      const member = team.members.find((m) => m.hunterId === target);
      if (!member) throw new ApiError('Ce joueur n’est pas dans l’équipe.');
      if (role === 'captain') for (const m of team.members) if (m.role === 'captain') m.role = null;
      member.role = role;
      return team;
    });
  }

  joinSolo(huntId: number): Observable<Team> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.joinableHunt(huntId, me);
      if (h.teamGame) throw new ApiError('Cette Secret Track se joue en équipe.');
      return this.addTeam(h, this.nick(me), me, true);
    });
  }

  leaveHunt(huntId: number): Observable<void> {
    return this.reply(() => {
      const me = this.requireUser();
      const team = this.teamOf(huntId, me);
      if (!team) return;
      const h = this.db.hunts.find((x) => x.id === huntId)!;
      if (h.surprise && h.hostId === me) throw new ApiError('Vous avez créé cette expédition : vous ne pouvez pas la quitter.');
      if (h.status !== 'published' && !(openToLateTeams(h) && !team.started)) throw new ApiError('La Secret Track a déjà commencé.');
      team.members = team.members.filter((m) => m.hunterId !== me);
      if (team.members.length === 0) this.db.teams = this.db.teams.filter((t) => t.id !== team.id);
      else if (team.ownerId === me) team.ownerId = team.members[0].hunterId;
      if (h.status === 'running') this.closeSurpriseIfAllArrived(h);
    });
  }

  setStartOrder(huntId: number, teamIds: number[]): Observable<Team[]> {
    return this.reply(() => {
      const h = this.ownedHunt(huntId);
      if (h.status !== 'published') throw new ApiError('L’ordre de passage se fixe avant le déclenchement.');
      teamIds.forEach((id, i) => {
        const t = this.db.teams.find((x) => x.id === id && x.huntId === huntId);
        if (t) t.startOrder = i + 1;
      });
      return this.db.teams.filter((t) => t.huntId === huntId).sort((a, b) => (a.startOrder ?? 999) - (b.startOrder ?? 999));
    });
  }

  delayTeam(teamId: number, minutes: number): Observable<Team> {
    return this.reply(() => {
      const t = this.db.teams.find((x) => x.id === teamId);
      if (!t) throw new ApiError('Équipe introuvable.');
      const h = this.ownedHunt(t.huntId);
      if (h.status !== 'running' || !t.started) throw new ApiError('La Secret Track n’est pas en cours.');
      const shifted = Date.parse(t.started) + minutes * 60_000;
      t.started = new Date(Math.max(shifted, Date.parse(h.started!))).toISOString();
      return t;
    });
  }

  /* ---------- Jeu ---------- */

  getPlay(huntId: number): Observable<PlayState> {
    return this.reply(() => this.playState(huntId));
  }

  revealHint(huntId: number): Observable<PlayState> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.playState(huntId);
      const clue = state.clue;
      if (!clue) throw new ApiError('Aucune énigme en cours.');
      if (clue.hintsRevealed.length >= clue.hintsTotal) throw new ApiError('Tous les jokers sont déjà dévoilés.');
      this.db.hintUses.push({
        teamId: state.team.id,
        stepId: clue.stepId,
        level: clue.hintsRevealed.length + 1,
        hunterId: me,
        at: new Date().toISOString(),
      });
      return this.playState(huntId);
    });
  }

  skipStep(huntId: number): Observable<PlayState> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.playState(huntId);
      const clue = state.clue;
      if (!clue) throw new ApiError('Aucune épreuve en cours.');
      const target = this.stepsOf(huntId).find((s) => s.order === clue.targetOrder)!;
      this.recordSkip(state.team.id, target, me);
      return this.playState(huntId);
    });
  }

  abandonHunt(huntId: number): Observable<PlayState> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.playState(huntId);
      const team = this.db.teams.find((t) => t.id === state.team.id)!;
      if (team.abandoned) return state;
      if (team.finished) throw new ApiError('Votre équipe est déjà arrivée.');
      if (state.hunt.status !== 'running' || !team.started || Date.parse(team.started) > Date.now()) {
        throw new ApiError('Votre partie n’a pas commencé : vous pouvez simplement quitter la Secret Track.');
      }
      team.abandoned = new Date().toISOString();
      this.closeSurpriseIfAllArrived(this.db.hunts.find((h) => h.id === huntId)!);
      void me;
      return this.playState(huntId);
    });
  }

  /** Épreuve abandonnée ; sur l'arrivée, l'équipe a fini son parcours (classée après celles qui ont trouvé le trésor). */
  private recordSkip(teamId: number, target: Step, me: number, at?: string): void {
    const team = this.db.teams.find((t) => t.id === teamId)!;
    const now = at ?? new Date().toISOString();
    this.db.validations.push({ teamId, stepId: target.id, hunterId: me, source: 'SKIP', at: now });
    this.arrivals.delete(`${teamId}:${target.id}`);
    if (target.order === finalOrder(this.stepsOf(team.huntId))) {
      team.finished = now;
      this.closeSurpriseIfAllArrived(this.db.hunts.find((h) => h.id === team.huntId)!);
    }
  }

  scan(token: string): Observable<ScanResult> {
    return this.reply(() => {
      const step = this.db.steps.find((s) => s.token === token) ?? null;
      const rawHunt = step ? this.db.hunts.find((h) => h.id === step.huntId)! : null;
      const me = this.viewer();
      const team = rawHunt ? this.teamOf(rawHunt.id, me) : null;
      const steps = rawHunt ? this.stepsOf(rawHunt.id) : [];
      const validations = team ? this.db.validations.filter((v) => v.teamId === team.id) : [];
      const outcome = evaluateScan({ hunt: rawHunt ? this.huntView(rawHunt) : null, steps, step, viewerId: me, team, validations, now: Date.now() });

      const result: ScanResult = { outcome, hunt: null, step: null, next: null, team, podium: null };
      if (outcome === 'unknown') return result;
      result.hunt = this.huntView(rawHunt!);
      const final = finalOrder(steps);
      const stepInfo = {
        order: step!.order,
        title: step!.title,
        arrival: step!.arrival,
        isFinal: step!.order === final,
        illustration: this.illustration(step!, 'arrival'),
        credit: this.illustrationCredit(step!, 'arrival'),
      };

      if (outcome === 'validated' && this.arrive(team!.id, step!, me!, 'QR') === 'puzzle') {
        result.outcome = 'puzzle';
        result.step = { ...stepInfo, arrival: null, illustration: null, credit: null };
        return result;
      }
      if (outcome === 'organizer') {
        result.step = stepInfo;
        result.next = step!.instructions
          ? {
              stepId: step!.id,
              targetOrder: step!.order + 1,
              instructions: step!.instructions,
              hintsRevealed: step!.hints,
              hintsTotal: step!.hints.length,
              canSkip: true,
              illustration: this.illustration(steps.find((s) => s.order === step!.order + 1), 'clue'),
              credit: this.illustrationCredit(steps.find((s) => s.order === step!.order + 1), 'clue'),
            }
          : null;
      }
      if (outcome === 'validated' || outcome === 'already_validated') {
        result.step = stepInfo;
        result.next = this.playState(rawHunt!.id).clue;
      }
      if (outcome === 'closed') result.podium = this.ranking(rawHunt!.id).slice(0, 3);
      return result;
    });
  }

  checkin(huntId: number, pos: { lat: number; lng: number; accuracy: number }): Observable<CheckinResult> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.visibleHunt(huntId);
      if (h.validation !== 'geo') throw new ApiError('Cette Secret Track se joue avec les QR codes posés sur place.');
      const state = this.playState(huntId);
      const clue = state.clue;
      if (!clue) throw new ApiError('Aucune étape à trouver pour le moment.');
      const steps = this.stepsOf(huntId);
      const target = steps.find((s) => s.order === clue.targetOrder)!;
      const check = arrivalCheck(target, h, pos);
      if (!check) throw new ApiError('Ce lieu n’est pas placé sur la carte : prévenez l’organisateur.');
      const { distance, allowed } = check;
      this.geoChecks.push({ stepId: target.id, huntId, order: target.order, ok: check.ok, distance, accuracy: pos.accuracy, source: 'play' });
      if (!check.ok) return { outcome: 'too_far', distance, allowed, step: null, state } satisfies CheckinResult;
      const final = finalOrder(steps);
      if (this.arrive(state.team.id, target, me, 'GEO') === 'puzzle') {
        return { outcome: 'puzzle', distance, allowed, step: null, state: this.playState(huntId) } satisfies CheckinResult;
      }
      return {
        outcome: 'validated',
        distance,
        allowed,
        step: { order: target.order, title: target.title, arrival: target.arrival, isFinal: target.order === final },
        state: this.playState(huntId),
      } satisfies CheckinResult;
    });
  }

  selfStart(huntId: number): Observable<PlayState> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.visibleHunt(huntId);
      const team = this.teamOf(huntId, me);
      if (!team) throw new ApiError('Secret Track introuvable.');
      if (!h.surprise) throw new ApiError('Le départ est donné par l’organisateur.');
      if (h.selfPaced) {
        if (team.started) throw new ApiError('Votre équipe est déjà partie.');
        if (h.status !== 'published' && h.status !== 'running') throw new ApiError('Cette expédition est terminée.');
        const now = new Date().toISOString();
        if (h.status === 'published') {
          h.status = 'running';
          h.started = now;
        }
        team.started = now;
      } else {
        if (h.hostId !== me) throw new ApiError(`Le départ sera donné par ${this.nick(h.hostId!)}.`);
        if (h.status !== 'published') throw new ApiError('Cette expédition est déjà partie.');
        this.start(h);
      }
      return this.playState(huntId);
    });
  }

  setSelfPaced(huntId: number, selfPaced: boolean): Observable<Hunt> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.visibleHunt(huntId);
      if (!h.surprise) throw new ApiError('Secret Track introuvable.');
      if (h.hostId !== me) throw new ApiError('Seul le créateur de l’expédition choisit le mode de départ.');
      if (h.status !== 'published') throw new ApiError('L’expédition est déjà partie.');
      h.selfPaced = selfPaced;
      return this.huntView(h);
    });
  }

  /* ---------- Génération ---------- */

  generateHunt(request: GenerationRequest): Observable<GenerationJob> {
    return this.reply(() => {
      const me = this.requireUser();
      if (request.skin) this.checkExtensions(me, { skin: request.skin }, null);
      // Qui règle la chasse (§ 21), comme le serveur.
      const access = this.access(me);
      if (!access.right) throw new ApiError(access.blocked ?? 'La Secret Track sur mesure est payante : choisissez une Secret Track à l’unité ou un forfait.');
      this.genUses.push({ hunterId: me, at: Date.now(), right: access.right });
      // Épreuves proposées par l'IA : seulement les types des packs du joueur.
      const missing = (request.puzzles ?? []).map((t) => puzzleType(t)).find((t) => !owns(this.purchases.get(me) ?? new Set(), t.pack));
      if (missing) throw new ApiError(`« ${missing.name} » vient du pack « ${productById(missing.pack)!.name} » : obtenez-le d’abord dans la boutique.`);
      const { lat, lng, query } = request.location;
      const center = lat !== undefined && lng !== undefined ? { lat, lng } : MONTPELLIER;
      const placeName = query?.trim() || 'votre quartier';
      const plan = demoPlan(center, plannedStepCount(request), placeName, request.puzzles ?? []);
      const play = request.mode === 'play';
      if (play && !this.db.hunters.some((x) => x.id === SYSTEM_ID)) {
        this.db.hunters.push({ id: SYSTEM_ID, nickname: 'SecretTracks', email: 'generateur@treasurehunters.invalid', password: '', rateable: false });
      }
      const id = this.nextId(this.db.hunts);
      const begin = Date.now();
      const h: MockDb['hunts'][number] = {
        id,
        ownerId: play ? SYSTEM_ID : me,
        name: plan.name,
        description: plan.description,
        location: placeName,
        begin: new Date(begin).toISOString(),
        end: new Date(begin + (play ? 7 * 86_400_000 : request.durationMinutes * 60_000 * 2)).toISOString(),
        started: null,
        closed: null,
        autoStart: false,
        autoClose: true,
        award: plan.award,
        startMode: 'mass',
        interval: null,
        hintPenalties: [2, 5, 10],
        skipPenalty: 30,
        validation: 'geo',
        geoRadius: 40,
        generated: true,
        surprise: play,
        travel: request.travel,
        skin: request.skin ?? DEFAULT_SKIN,
        // Les outils que le joueur possède, en plus de la position en direct.
        tools: [...new Set([...DEFAULT_TOOLS, ...TOOL_IDS.filter((t) => this.purchases.get(me)?.has(`tool:${t}`))])],
        difficulty: request.difficulty,
        durationMinutes: request.durationMinutes,
        hostId: play ? me : null,
        catalogId: null,
        selfPaced: true,
        teamGame: true,
        teamMin: 1,
        teamMax: 6,
        isPublic: false,
        joinCode: randomToken(6).toUpperCase(),
        contribution: 0,
        startText: plan.startText,
        status: play ? 'published' : 'draft',
      };
      this.db.hunts.push(h);
      plan.steps.forEach((p, order) =>
        this.db.steps.push({
          ...this.blankStep(id, order, p.title),
          arrival: p.arrival,
          instructions: p.instructions,
          hints: p.hints,
          latitude: p.latitude,
          longitude: p.longitude,
          address: p.address,
          puzzle: order > 0 ? (p.puzzle ?? null) : null,
        }),
      );
      if (play) this.addTeam(h, this.nick(me), me, false);
      const theme = request.theme?.trim();
      const note = theme ? `Thème « ${theme} » : la maquette ne cherche pas de vrais lieux, elle ne l’a pas suivi.` : null;
      const job = { id: randomToken(12), status: 'pending' as const, mode: request.mode, huntId: null, error: null, note: null };
      this.jobs.set(job.id, { ...job, huntId: id, note, readyAt: Date.now() + GENERATION_MS, ownerId: me });
      return job;
    });
  }

  getGeneration(id: string): Observable<GenerationJob> {
    return this.reply(() => {
      const job = this.jobs.get(id);
      if (!job || job.ownerId !== this.requireUser()) throw new ApiError('Génération introuvable.');
      const done = Date.now() >= job.readyAt;
      return { id: job.id, status: done ? 'done' : 'pending', mode: job.mode, huntId: done ? job.huntId : null, error: null, note: done ? job.note : null } satisfies GenerationJob;
    });
  }

  /* ---------- Résultats et pilotage ---------- */

  getResults(huntId: number): Observable<RankingRow[]> {
    return this.reply(() => {
      const h = this.visibleHunt(huntId);
      const me = this.viewer();
      const ended = h.status === 'closed' || h.status === 'archived';
      if (!ended && h.ownerId !== me) throw new ApiError('Les résultats seront publiés à la clôture de la Secret Track.');
      return this.ranking(huntId);
    });
  }

  getLive(huntId: number): Observable<LiveRow[]> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      return this.liveRows(huntId);
    });
  }

  validateManually(teamId: number, stepId: number): Observable<LiveRow[]> {
    return this.reply(() => {
      const t = this.db.teams.find((x) => x.id === teamId);
      if (!t) throw new ApiError('Équipe introuvable.');
      const h = this.ownedHunt(t.huntId);
      const steps = this.stepsOf(h.id);
      const step = steps.find((s) => s.id === stepId);
      if (!step) throw new ApiError('Étape introuvable.');
      const vals = this.db.validations.filter((v) => v.teamId === teamId);
      if (step.order !== lastValidatedOrder(steps, vals) + 1) throw new ApiError('Seule l’étape suivante de l’équipe peut être validée.');
      const now = new Date().toISOString();
      this.db.validations.push({ teamId, stepId, hunterId: t.ownerId, source: 'MANUAL', at: now });
      this.arrivals.delete(`${teamId}:${stepId}`);
      if (step.order === finalOrder(steps)) t.finished = now;
      return this.liveRows(h.id);
    });
  }

  /* ---------- Catalogue (§ 13) ---------- */

  listCatalog(opts: CatalogQuery = {}): Observable<CatalogEntry[]> {
    return this.reply(() => {
      let list = this.catalog;
      if (opts.mine || opts.hunt) {
        const me = this.requireUser();
        list = list.filter((e) => e.authorId === me && (!opts.hunt || e.huntId === opts.hunt));
      } else {
        list = list.filter((e) => !e.withdrawn);
      }
      const q = opts.q?.trim().toLowerCase();
      if (q) list = list.filter((e) => [e.title, e.location, e.summary].some((t) => t.toLowerCase().includes(q)));
      if (opts.travel?.length) list = list.filter((e) => opts.travel!.includes(e.travel));
      if (opts.difficulty?.length) list = list.filter((e) => opts.difficulty!.includes(e.difficulty));
      if (opts.minDuration) list = list.filter((e) => e.durationMinutes >= opts.minDuration!);
      if (opts.maxDuration) list = list.filter((e) => e.durationMinutes <= opts.maxDuration!);
      if (opts.autonomous) list = list.filter((e) => e.validation === 'geo');
      if (opts.practical?.length) list = list.filter((e) => opts.practical!.every((t) => e.practical.includes(t)));
      if (opts.audience?.length) list = list.filter((e) => opts.audience!.some((a) => e.audience.includes(a)));
      if (opts.setting?.length) list = list.filter((e) => e.setting !== null && opts.setting!.includes(e.setting));
      if (opts.price) list = list.filter((e) => (opts.price === 'free' ? e.price === 0 : e.price > 0));
      let views = list.map((e) => this.entryView(e, opts.near));
      if (opts.maxKm) views = views.filter((v) => v.km !== null && v.km <= opts.maxKm!);
      if (opts.session) {
        const until = opts.session === 'today' ? new Date().setHours(24, 0, 0, 0) : Date.now() + 7 * 86_400_000;
        views = views.filter((v) => v.nextSession !== null && Date.parse(v.nextSession) < until);
      }
      if (opts.near && opts.radius) views = views.filter((v) => v.distanceKm !== null && v.distanceKm <= opts.radius!);
      const sort = opts.sort === 'distance' && !opts.near ? 'rating' : (opts.sort ?? 'rating');
      return views.sort((a, b) =>
        sort === 'recent'
          ? b.id - a.id
          : sort === 'plays'
            ? b.plays - a.plays || b.id - a.id
            : sort === 'distance'
              ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || b.id - a.id
              : (b.rating.stars ?? -1) - (a.rating.stars ?? -1) || b.rating.count - a.rating.count || b.id - a.id,
      );
    });
  }

  getCatalogEntry(id: number): Observable<CatalogDetail> {
    return this.reply(() => this.entryDetail(id));
  }

  copyFromCatalog(id: number): Observable<Hunt> {
    return this.reply(() => {
      const me = this.requireUser();
      return this.huntView(this.instantiate(this.catalogEntryFor(id, me, 'copier'), me, false));
    });
  }

  /** Jouer en autonomie (§ 13.5), comme le serveur : partie privée, lancée sur place dans l'année. */
  playFromCatalog(id: number, challenge?: number): Observable<Hunt> {
    return this.reply(() => {
      const me = this.requireUser();
      const e = this.catalogEntryFor(id, me, 'jouer');
      if (challenge !== undefined) this.challengeSource(id, challenge);
      if (e.validation !== 'geo') throw new ApiError('Cette Secret Track se joue avec des QR codes posés par un organisateur : elle ne se joue pas en autonomie.');
      const waiting = this.db.hunts.find(
        (h) => h.catalogId === id && h.surprise && h.hostId === me && h.status === 'published' && this.db.teams.some((t) => t.huntId === h.id && t.ownerId === me && !t.started),
      );
      if (waiting) {
        if (challenge !== undefined) this.challengeOf.set(waiting.id, this.challengeOf.get(waiting.id) ?? challenge);
        return this.huntView(waiting);
      }
      const h = this.instantiate(e, me, true);
      if (challenge !== undefined) this.challengeOf.set(h.id, challenge);
      this.addTeam(h, this.nick(me), me, false);
      return this.huntView(h);
    });
  }

  autonomyLeaderboard(id: number): Observable<AutonomyLeaderboard> {
    return this.reply(() => this.autonomyBoard(id));
  }

  /* ---------- Favoris et listes (§ 38), comme le serveur ---------- */

  private listView(l: MockList, me: number): TrackList {
    return {
      id: l.id,
      name: l.name,
      icon: l.icon,
      favorite: l.favorite,
      ownerNickname: this.nick(l.ownerId),
      mine: l.ownerId === me,
      code: l.code,
      members: l.members.map((m) => this.nick(m)),
      catalogIds: [...l.items],
    };
  }

  private memberList(id: number): { l: MockList; me: number } {
    const me = this.requireUser();
    const l = this.lists.find((x) => x.id === id && (x.ownerId === me || x.members.includes(me)));
    if (!l) throw new ApiError('Liste introuvable.');
    return { l, me };
  }

  private ownedList(id: number): { l: MockList; me: number } {
    const r = this.memberList(id);
    if (r.l.ownerId !== r.me) throw new ApiError('Seul le créateur de la liste peut la modifier.');
    return r;
  }

  myLists(): Observable<TrackList[]> {
    return this.reply(() => {
      const me = this.requireUser();
      if (!this.lists.some((l) => l.ownerId === me && l.favorite)) {
        this.lists.push({ id: this.lists.length + 1, ownerId: me, name: FAVORITE_NAME, icon: 'favorite', favorite: true, code: null, members: [], items: [] });
      }
      return this.lists
        .filter((l) => l.ownerId === me || l.members.includes(me))
        .sort((a, b) => Number(b.ownerId === me && b.favorite) - Number(a.ownerId === me && a.favorite) || a.id - b.id)
        .map((l) => this.listView(l, me));
    });
  }

  getList(id: number): Observable<TrackListDetail> {
    return this.reply(() => {
      const { l, me } = this.memberList(id);
      const entries = l.items.map((c) => this.catalog.find((e) => e.id === c && !e.withdrawn)).filter((e): e is MockEntry => !!e);
      return { ...this.listView(l, me), entries: entries.map((e) => this.entryView(e)) };
    });
  }

  createList(name: string, icon: string): Observable<TrackList> {
    return this.reply(() => {
      const me = this.requireUser();
      if (this.lists.filter((l) => l.ownerId === me).length >= LISTS_MAX) throw new ApiError(`${LISTS_MAX} listes au plus : supprimez-en une avant d'en créer une autre.`);
      const l: MockList = { id: this.lists.length + 1, ownerId: me, name: name.trim(), icon, favorite: false, code: null, members: [], items: [] };
      this.lists.push(l);
      return this.listView(l, me);
    });
  }

  updateList(id: number, data: { name?: string; icon?: string; shared?: boolean }): Observable<TrackList> {
    return this.reply(() => {
      const { l, me } = this.ownedList(id);
      if (data.name !== undefined && !l.favorite) l.name = data.name.trim();
      if (data.icon !== undefined) l.icon = data.icon;
      if (data.shared === true && !l.code) l.code = randomToken(8).toUpperCase().replace(/[^A-Z2-9]/g, 'X');
      if (data.shared === false) Object.assign(l, { code: null, members: [] });
      return this.listView(l, me);
    });
  }

  deleteList(id: number): Observable<void> {
    return this.reply(() => {
      const { l } = this.ownedList(id);
      if (l.favorite) throw new ApiError('La liste « À faire » ne se supprime pas ; retirez-en les Secret Tracks.');
      this.lists.splice(this.lists.indexOf(l), 1);
    });
  }

  joinList(code: string): Observable<TrackList> {
    return this.reply(() => {
      const me = this.requireUser();
      const l = this.lists.find((x) => x.code && x.code === code.trim().toUpperCase());
      if (!l) throw new ApiError('Aucune liste partagée avec ce code.');
      if (l.ownerId !== me && !l.members.includes(me)) l.members.push(me);
      return this.listView(l, me);
    });
  }

  leaveList(id: number): Observable<void> {
    return this.reply(() => {
      const { l, me } = this.memberList(id);
      if (l.ownerId === me) throw new ApiError('Vous avez créé cette liste : supprimez-la plutôt.');
      l.members = l.members.filter((m) => m !== me);
    });
  }

  listAdd(id: number, catalogId: number): Observable<TrackList> {
    return this.reply(() => {
      const { l, me } = this.memberList(id);
      if (!this.catalog.some((e) => e.id === catalogId && !e.withdrawn)) throw new ApiError('Cette Secret Track n’est pas au catalogue.');
      if (!l.items.includes(catalogId)) l.items.unshift(catalogId);
      return this.listView(l, me);
    });
  }

  listRemove(id: number, catalogId: number): Observable<TrackList> {
    return this.reply(() => {
      const { l, me } = this.memberList(id);
      l.items = l.items.filter((c) => c !== catalogId);
      return this.listView(l, me);
    });
  }

  /** Surprends-moi (§ 37), comme le serveur. */
  surprise(q: SurpriseQuery): Observable<Surprise> {
    return this.reply(() => {
      const me = this.viewer();
      let views = this.catalog.filter((e) => !e.withdrawn && e.validation === 'geo').map((e) => this.entryView(e, q.near));
      if (q.near) views = views.filter((v) => v.distanceKm !== null && v.distanceKm <= (q.radius ?? SURPRISE_RADIUS));
      const mine = this.db.teams.filter((t) => t.finished && me !== null && t.members.some((m) => m.hunterId === me)).map((t) => this.db.hunts.find((h) => h.id === t.huntId)!);
      const played = new Set(mine.flatMap((h) => [h.catalogId, ...this.catalog.filter((e) => e.huntId === h.id).map((e) => e.id)]).filter((x): x is number => x !== null));
      const counts = new Map<Travel, number>();
      for (const h of mine) if (h.travel) counts.set(h.travel, (counts.get(h.travel) ?? 0) + 1);
      const usualTravel = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return pickSurprise(views, { played, usualTravel, minutes: q.minutes, exclude: q.exclude });
    });
  }

  /** Parties à reprendre (§ 35), comme le serveur. */
  getInProgress(): Observable<GameInProgress[]> {
    return this.reply(() => {
      const me = this.requireUser();
      return this.db.teams
        .filter((t) => t.started && Date.parse(t.started) <= Date.now() && !t.finished && !t.abandoned && t.members.some((m) => m.hunterId === me))
        .map((t) => ({ t, h: this.db.hunts.find((x) => x.id === t.huntId)! }))
        .filter(({ h }) => h.status === 'running')
        .map(({ t, h }) => {
          const steps = this.stepsOf(h.id);
          const total = finalOrder(steps);
          const vals = this.db.validations.filter((v) => v.teamId === t.id);
          return {
            huntId: h.id,
            name: h.name,
            skin: h.skin,
            location: h.location,
            step: Math.min(total, lastValidatedOrder(steps, vals) + 1),
            totalSteps: total,
            started: t.started!,
            autonomous: h.surprise && h.hostId !== null && h.catalogId !== null,
          };
        });
    });
  }

  /** Carnet d'explorateur (§ 29), comme le serveur. */
  getJournal(): Observable<ExplorerJournal> {
    return this.reply(() => {
      const me = this.requireUser();
      const hunts: JournalHunt[] = [];
      const history: HistoryEntry[] = [];
      for (const t of this.db.teams.filter((x) => x.members.some((m) => m.hunterId === me))) {
        const hv = this.db.hunts.find((x) => x.id === t.huntId);
        if (!hv) continue;
        const ranking = this.ranking(hv.id);
        const stars = this.ratings.find((r) => r.huntId === hv.id && r.hunterId === me)?.rating.stars ?? null;
        history.push(historyEntry({ hunt: this.huntView(hv), team: t, ranking, total: finalOrder(this.stepsOf(hv.id)), stars, me, now: Date.now() }));
        if (!t.finished || !t.started) continue;
        const h = hv;
        const row = ranking.find((r) => r.teamId === t.id);
        if (!row?.time || !row.started || row.treasureSkipped) continue;
        const steps = this.stepsOf(h.id);
        const found = this.db.validations
          .filter((v) => v.teamId === t.id && v.source !== 'SKIP')
          .map((v) => steps.find((s) => s.id === v.stepId)!)
          .sort((a, b) => a.order - b.order);
        const places = [steps.find((s) => s.order === 0), ...found]
          .filter((s): s is Step => !!s && s.latitude !== null && s.longitude !== null)
          .map((s) => ({ lat: s.latitude!, lng: s.longitude! }));
        const meters = places.slice(1).reduce((a, p, i) => a + distanceMeters(places[i]!, p), 0);
        hunts.push({
          huntId: h.id,
          name: h.name,
          location: h.location,
          skin: h.skin,
          date: row.started,
          time: row.time,
          found: found.length,
          hints: row.hints,
          autonomous: h.surprise && h.hostId !== null && h.catalogId !== null,
          catalogId: h.catalogId,
          km: Math.round(meters / 100) / 10,
        });
      }
      return explorerJournal(hunts, history);
    });
  }

  /** Défi « bats mon temps » (§ 28), comme le serveur. */
  getChallenge(id: number, huntId: number): Observable<Challenge> {
    return this.reply(() => this.challengeView(id, huntId));
  }

  setChallenge(id: number, huntId: number, message: string | null): Observable<Challenge> {
    return this.reply(() => {
      const me = this.requireUser();
      const row = this.challengeSource(id, huntId);
      if (!this.db.teams.find((t) => t.id === row.teamId)?.members.some((m) => m.hunterId === me)) throw new ApiError('Seule l’équipe qui a joué cette partie peut lancer ce défi.');
      this.challengeNotes.set(huntId, { authorId: me, message: message?.trim() || null });
      return this.challengeView(id, huntId);
    });
  }

  private challengeSource(id: number, huntId: number): RankingRow {
    const h = this.db.hunts.find((x) => x.id === huntId);
    if (!h || h.catalogId !== id || !h.surprise || h.hostId === null) throw new ApiError('Ce défi n’existe pas.');
    const row = this.ranking(huntId).find((r) => r.time !== null && r.finished);
    if (!row) throw new ApiError('Cette partie n’est pas encore terminée : pas de temps à battre.');
    return row;
  }

  /** Défis étendus (§ 39), comme le serveur : le mot du lanceur et ceux qui relèvent le défi. */
  private challengeView(id: number, huntId: number): Challenge {
    const row = this.challengeSource(id, huntId);
    const board = this.autonomyBoard(id);
    const rank = 1 + board.rows.filter((r) => r.time < row.time! || (r.time === row.time && Date.parse(r.finished) < Date.parse(row.finished!))).length;
    const note = this.challengeNotes.get(huntId);
    const me = this.viewer();
    const takers: ChallengeTaker[] = [...this.challengeOf]
      .filter(([, source]) => source === huntId)
      .map(([takerHunt]) => this.db.teams.find((t) => t.huntId === takerHunt))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => {
        const r = this.ranking(t.huntId).find((x) => x.teamId === t.id);
        const time = r?.finished && r.time !== null ? r.time : null;
        return {
          teamName: t.name,
          status: t.finished ? 'finished' : t.started && Date.parse(t.started) <= Date.now() ? 'playing' : 'waiting',
          time,
          beaten: time === null ? null : time < row.time!,
          mine: me !== null && t.members.some((m) => m.hunterId === me),
        } satisfies ChallengeTaker;
      })
      .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    return {
      catalogId: id,
      huntId,
      teamName: row.teamName,
      time: row.time!,
      rank,
      finishers: board.finishers,
      finished: row.finished!,
      authorNickname: note ? this.nick(note.authorId) : null,
      message: note?.message ?? null,
      takers,
    };
  }

  /** Souvenir de fin de partie (§ 24), comme le serveur. */
  getSouvenir(huntId: number): Observable<Souvenir> {
    return this.reply(() => {
      const me = this.requireUser();
      const h = this.visibleHunt(huntId);
      const team = this.teamOf(huntId, me);
      if (!team) throw new ApiError('Vous n’êtes pas inscrit à cette Secret Track.');
      if (!team.finished || !team.started) throw new ApiError('Le souvenir sera prêt à l’arrivée de votre équipe.');
      const steps = this.stepsOf(huntId);
      const ranking = this.ranking(huntId);
      const row = ranking.find((r) => r.teamId === team.id)!;
      let rank: number | null = null;
      let ranked = 0;
      let scope: Souvenir['scope'] = 'hunt';
      if (h.surprise && h.hostId !== null && h.catalogId !== null) {
        const board = this.autonomyBoard(h.catalogId);
        scope = 'catalog';
        ranked = board.finishers;
        rank = board.rows.find((r) => r.mine && r.finished === team.finished)?.rank ?? null;
      } else if (h.status !== 'running' || h.tools.includes('live')) {
        ranked = ranking.filter((r) => r.rank !== null).length;
        rank = row.rank;
      }
      const found = this.db.validations
        .filter((v) => v.teamId === team.id && v.source !== 'SKIP')
        .map((v) => steps.find((s) => s.id === v.stepId)!)
        .sort((a, b) => a.order - b.order);
      const places = [steps.find((s) => s.order === 0), ...found]
        .filter((s): s is Step => !!s && s.latitude !== null && s.longitude !== null)
        .map((s) => ({ lat: s.latitude!, lng: s.longitude! }));
      return {
        huntId,
        huntName: h.name,
        skin: h.skin,
        location: h.location,
        date: team.started,
        teamName: team.name,
        members: team.members.map((m) => m.nickname),
        time: row.time ?? 0,
        penalty: row.penalty / 60,
        rank: ranked > 1 ? rank : null,
        ranked,
        scope,
        provisional: scope === 'hunt' && h.status === 'running',
        found: found.length,
        skipped: row.skips,
        totalSteps: finalOrder(steps),
        hints: row.hints,
        trail: sketchTrail(places),
        catalogId: h.catalogId,
      };
    });
  }

  private autonomyBoard(id: number): AutonomyLeaderboard {
    const me = this.viewer();
    const hunts = this.db.hunts.filter((h) => h.catalogId === id && h.surprise && h.hostId !== null);
    let players = 0;
    const rows: (AutonomyRow & { at: number })[] = [];
    for (const h of hunts) {
      const teams = this.db.teams.filter((t) => t.huntId === h.id);
      players += teams.filter((t) => t.started).length;
      for (const r of this.ranking(h.id)) {
        if (r.time === null || !r.finished) continue;
        const team = teams.find((t) => t.id === r.teamId)!;
        rows.push({ rank: 0, teamName: r.teamName, members: r.members.length, time: r.time, penalty: r.penalty, hints: r.hints, skips: r.skips, finished: r.finished, mine: team.members.some((m) => m.hunterId === me), at: Date.parse(r.finished) });
      }
    }
    rows.sort((a, b) => a.time - b.time || a.at - b.at);
    rows.forEach((r, i) => (r.rank = i + 1));
    return { finishers: rows.length, players, rows: rows.map(({ at, ...r }) => r) };
  }

  private catalogEntryFor(id: number, me: number, verb: string): MockEntry {
    const e = this.catalog.find((x) => x.id === id && !x.withdrawn);
    if (!e) throw new ApiError('Cette Secret Track n’est pas au catalogue.');
    if (e.price > 0 && e.authorId !== me && !this.purchases.get(me)?.has(`hunt:c${id}`)) throw new ApiError(`Cette Secret Track est payante : achetez-la pour la ${verb}.`);
    return e;
  }

  /** Chasse tirée d'une version : brouillon à organiser, ou partie en autonomie (compte système, hôte = joueur). */
  private instantiate(e: MockEntry, me: number, play: boolean): MockDb['hunts'][number] {
    if (play && !this.db.hunters.some((x) => x.id === SYSTEM_ID)) {
      this.db.hunters.push({ id: SYSTEM_ID, nickname: 'SecretTracks', email: 'generateur@treasurehunters.invalid', password: '', rateable: false });
    }
    const begin = play ? Date.now() : Date.now() + 7 * 86_400_000;
    const h: MockDb['hunts'][number] = {
      ...structuredClone(e.content.hunt),
      skin: e.content.hunt.skin ?? DEFAULT_SKIN,
      tools: [...(e.content.hunt.tools ?? DEFAULT_TOOLS)],
      id: this.nextId(this.db.hunts),
      ownerId: play ? SYSTEM_ID : me,
      begin: new Date(begin).toISOString(),
      end: new Date(begin + (play ? 365 * 86_400_000 : 3 * 3_600_000)).toISOString(),
      started: null,
      closed: null,
      autoStart: false,
      autoClose: play,
      generated: false,
      surprise: play,
      hostId: play ? me : null,
      selfPaced: true,
      catalogId: e.id,
      travel: e.travel,
      difficulty: e.difficulty,
      durationMinutes: e.durationMinutes,
      isPublic: false,
      joinCode: randomToken(6).toUpperCase(),
      status: play ? 'published' : 'draft',
      ...(play ? { teamGame: true, teamMin: 1, teamMax: 6, startMode: 'mass' as const, interval: null } : {}),
    };
    this.db.hunts.push(h);
    for (const s of e.content.steps) this.db.steps.push({ ...this.blankStep(h.id, s.order, s.title), ...structuredClone(s) });
    return h;
  }

  withdrawFromCatalog(id: number): Observable<CatalogDetail> {
    return this.reply(() => {
      const e = this.catalog.find((x) => x.id === id);
      if (!e) throw new ApiError('Cette Secret Track n’est pas au catalogue.');
      if (e.authorId !== this.requireUser()) throw new ApiError('Seul l’auteur retire sa Secret Track du catalogue.');
      e.withdrawn = true;
      return this.entryDetail(id);
    });
  }

  /** Comme le serveur (§ 48) : trop proche d'une Secret Track d'une autre lignée, la proposition est refusée. */
  private checkSimilarity(huntId: number, parentId: number | null, steps: MockEntry['content']['steps']): void {
    // La lignée : de la racine de la version d'origine à toutes les versions qui en dérivent.
    let root = parentId === null ? undefined : this.catalog.find((e) => e.id === parentId);
    while (root?.parentId) root = this.catalog.find((e) => e.id === root!.parentId);
    const family = new Set<number>(root ? [root.id] : []);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of this.catalog) if (e.parentId !== null && family.has(e.parentId) && !family.has(e.id)) grew = !!family.add(e.id);
    }
    const close = this.catalog
      .filter((e) => !e.withdrawn && e.huntId !== huntId && !family.has(e.id))
      .map((e) => ({ e, ratio: sharedStepRatio(steps, e.content.steps) }))
      .filter((c) => c.ratio > SIMILARITY_LIMIT)
      .sort((a, b) => b.ratio - a.ratio);
    if (!close.length) return;
    const list = close
      .slice(0, 3)
      .map((c) => `« ${c.e.title} » de ${this.db.hunters.find((x) => x.id === c.e.authorId)?.nickname ?? '?'} (${percent(c.ratio)} d’étapes en commun)`)
      .join(', ');
    throw new ApiError(
      `Votre parcours est trop proche d’une Secret Track déjà au catalogue : ${list}. Pour proposer des corrections ou des améliorations, ` +
        `copiez cette Secret Track depuis le catalogue et partagez-en une nouvelle version ; sinon, changez davantage d’étapes.`,
    );
  }

  publishToCatalog(huntId: number, pub: CatalogPublication): Observable<CatalogDetail> {
    return this.reply(() => this.entryDetail(this.publish(this.ownedHunt(huntId), pub).id));
  }

  /* ---------- Notations (§ 14) ---------- */

  getRating(huntId: number): Observable<RatingState> {
    return this.reply(() => this.ratingState(huntId));
  }

  rateHunt(huntId: number, rating: Rating): Observable<RatingState> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.ratingState(huntId);
      if (!state.canRate) throw new ApiError('Seuls les joueurs de cette Secret Track la notent, une fois close.');
      const value = { ...rating, comment: rating.comment?.trim() || null, organizer: state.organizerRateable ? rating.organizer : null };
      const existing = this.ratings.find((r) => r.huntId === huntId && r.hunterId === me);
      if (existing) existing.rating = value;
      else this.ratings.push({ huntId, hunterId: me, rating: value, at: new Date().toISOString() });
      return this.ratingState(huntId);
    });
  }

  getOrganizer(id: number): Observable<OrganizerProfile> {
    return this.reply(() => {
      const h = this.db.hunters.find((x) => x.id === id && x.id !== SYSTEM_ID);
      if (!h) throw new ApiError('Organisateur introuvable.');
      const owned = new Set(this.db.hunts.filter((x) => x.ownerId === id).map((x) => x.id));
      const notes = this.ratings.filter((r) => owned.has(r.huntId) && r.rating.organizer !== null).map((r) => r.rating.organizer!);
      return {
        id,
        nickname: h.nickname,
        rateable: h.rateable,
        rating: h.rateable ? { count: notes.length, stars: average(notes) } : null,
        entries: this.catalog.filter((e) => e.authorId === id && !e.withdrawn).map((e) => this.entryView(e)),
      };
    });
  }

  private ratingState(huntId: number): RatingState {
    const me = this.viewer();
    const h = this.visibleHunt(huntId);
    const owner = this.db.hunters.find((x) => x.id === h.ownerId)!;
    return {
      canRate: me !== null && !!this.teamOf(huntId, me) && h.ownerId !== me && ['closed', 'archived'].includes(h.status),
      organizerRateable: owner.rateable,
      organizerNickname: owner.nickname,
      mine: this.ratings.find((r) => r.huntId === huntId && r.hunterId === me)?.rating ?? null,
    };
  }

  private publish(h: MockDb['hunts'][number], pub: CatalogPublication, authorId = h.ownerId): MockEntry {
    const steps = this.stepsOf(h.id);
    const final = finalOrder(steps);
    if (final < 2) throw new ApiError('Il faut au moins une étape entre le départ et l’arrivée pour partager la Secret Track au catalogue.');
    const missing = steps.find((s) => s.order < final && !s.instructions?.trim());
    if (missing) throw new ApiError(`L’énigme ${missing.order === 0 ? 'de départ' : `de l’étape ${missing.order}`} n’est pas rédigée.`);
    const sample = steps.find((s) => s.order === pub.sampleOrder && s.order < final);
    if (!sample) throw new ApiError('Choisissez comme extrait une énigme du parcours.');
    const { name, description, location, award, startText, startMode, interval, hintPenalties, skipPenalty, teamGame, teamMin, teamMax, validation, geoRadius, contribution, skin, tools } = h;
    const content: MockEntry['content'] = {
      hunt: { name, description, location, award, startText, startMode, interval, hintPenalties, skipPenalty, teamGame, teamMin, teamMax, validation, geoRadius, contribution, skin, tools },
      steps: steps.map(({ order, title, arrival, instructions, hints, latitude, longitude, address }) => ({ order, title, arrival, instructions, hints, latitude, longitude, address })),
    };
    const fingerprint = JSON.stringify({ rules: [hintPenalties, skipPenalty, validation, geoRadius], steps: content.steps });
    const previous = this.catalog.filter((e) => e.huntId === h.id).at(-1);
    Object.assign(h, { travel: pub.travel, difficulty: pub.difficulty, durationMinutes: pub.durationMinutes });
    // Même parcours que sa dernière publication : on en corrige la fiche.
    if (previous && !previous.withdrawn && previous.fingerprint === fingerprint) {
      return Object.assign(previous, {
        summary: pub.summary.trim() || h.description,
        travel: pub.travel,
        difficulty: pub.difficulty,
        durationMinutes: pub.durationMinutes,
        sampleOrder: sample.order,
        sample: sample.instructions!,
        price: pub.price ?? 0,
        practical: [...new Set(pub.practical ?? [])],
        minAge: pub.minAge ?? null,
        audience: [...new Set(pub.audience ?? [])],
        setting: pub.setting ?? null,
      });
    }
    const parentId = previous?.id ?? h.catalogId;
    const parent = this.catalog.find((e) => e.id === parentId);
    if (parent && parent.fingerprint === fingerprint) {
      throw new ApiError(`Le parcours n’a pas changé depuis « ${parent.title} » : modifiez des étapes, des énigmes, des jokers ou des pénalités avant de partager une nouvelle version.`);
    }
    this.checkSimilarity(h.id, parent?.id ?? null, content.steps);
    const entry: MockEntry = {
      id: this.catalog.length + 1,
      authorId,
      huntId: h.id,
      parentId: parent?.id ?? null,
      title: h.name,
      summary: pub.summary.trim() || h.description,
      location: h.location,
      travel: pub.travel,
      difficulty: pub.difficulty,
      durationMinutes: pub.durationMinutes,
      stepCount: final,
      validation: h.validation,
      sampleOrder: sample.order,
      sample: sample.instructions!,
      changes: parent ? pub.changes?.trim() || null : null,
      content: structuredClone(content),
      fingerprint,
      published: new Date().toISOString(),
      withdrawn: false,
      price: pub.price ?? 0,
      practical: [...new Set(pub.practical ?? [])],
      minAge: pub.minAge ?? null,
      audience: [...new Set(pub.audience ?? [])],
      setting: pub.setting ?? null,
    };
    this.catalog.push(entry);
    return entry;
  }

  /** Parties qui comptent pour une version : la chasse qui l'a publiée et ses copies non republiées. */
  private entryHunts(e: MockEntry): number[] {
    const copies = this.db.hunts.filter((h) => h.catalogId === e.id && !this.catalog.some((x) => x.huntId === h.id)).map((h) => h.id);
    return [...(e.huntId ? [e.huntId] : []), ...copies];
  }

  private entryView(e: MockEntry, near?: { lat: number; lng: number }): CatalogEntry {
    // Premier lieu placé du parcours, comme le serveur (§ 23).
    const placed = e.content.steps.filter((s) => s.latitude !== null && s.longitude !== null).sort((a, b) => a.order - b.order)[0];
    const start = placed ? { lat: placed.latitude!, lng: placed.longitude! } : null;
    const hunts = new Set(this.entryHunts(e));
    const played = this.db.hunts.filter((h) => hunts.has(h.id) && ['closed', 'archived'].includes(h.status));
    const times = this.db.teams
      .filter((t) => hunts.has(t.huntId) && t.started && t.finished)
      .map((t) => (Date.parse(t.finished!) - Date.parse(t.started!)) / 60_000);
    const notes = this.ratings.filter((r) => hunts.has(r.huntId)).map((r) => r.rating);
    const parent = this.catalog.find((x) => x.id === e.parentId);
    return {
      id: e.id,
      skin: e.content.hunt.skin ?? DEFAULT_SKIN,
      authorId: e.authorId,
      authorNickname: this.nick(e.authorId),
      title: e.title,
      summary: e.summary,
      location: e.location,
      travel: e.travel,
      difficulty: e.difficulty,
      durationMinutes: e.durationMinutes,
      measuredMinutes: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
      stepCount: e.stepCount,
      cover: e.huntId !== null && this.coverStep(e.huntId) !== null,
      validation: e.validation,
      plays: played.length,
      rating: {
        count: notes.length,
        stars: average(notes.map((n) => n.stars)),
        riddles: average(notes.map((n) => n.riddles)),
        route: average(notes.map((n) => n.route)),
        mood: average(notes.map((n) => n.mood)),
      },
      parent: parent ? { id: parent.id, title: parent.title, authorNickname: this.nick(parent.authorId) } : null,
      versionCount: this.catalog.filter((x) => x.parentId === e.id && !x.withdrawn).length,
      changes: e.changes,
      published: e.published,
      withdrawn: e.withdrawn,
      price: e.price,
      start,
      distanceKm: start && near ? Math.round(distanceMeters(start, near) / 100) / 10 : null,
      practical: [...e.practical],
      minAge: e.minAge,
      km: routeKm(e.content.steps.filter((x) => x.latitude !== null && x.longitude !== null).sort((a, b) => a.order - b.order).map((x) => ({ lat: x.latitude!, lng: x.longitude! }))),
      finishers: times.length,
      audience: [...e.audience],
      setting: e.setting,
      nextSession: this.sessionsOf(e)[0]?.begin ?? null,
    };
  }

  /** Démonstration (§ 40) : Camille organise samedi une session de l'Écusson, départs toutes les 10 minutes. */
  private seedSession(): void {
    const e = this.catalog.find((x) => x.title === 'Les secrets de l’Écusson');
    if (!e) return;
    const h = this.instantiate(e, 2, false);
    const saturday = new Date();
    saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7));
    saturday.setHours(14, 0, 0, 0);
    Object.assign(h, {
      name: 'Rallye de l’Écusson',
      isPublic: true,
      status: 'published',
      begin: saturday.toISOString(),
      end: new Date(saturday.getTime() + 4 * 3_600_000).toISOString(),
      startMode: 'staggered',
      interval: 10,
    });
    this.addTeam(h, 'Les Lézards', 5, false);
    this.addTeam(h, 'Team Garrigue', 6, false);
  }

  /** Sessions publiques de la version (§ 40), comme le serveur : les plus proches d'abord. */
  private sessionsOf(e: MockEntry): MockDb['hunts'] {
    const hunts = new Set(this.entryHunts(e));
    return this.db.hunts
      .filter((h) => hunts.has(h.id) && h.isPublic && !h.surprise && ['published', 'running'].includes(h.status) && Date.parse(h.end) > Date.now())
      .sort((a, b) => Date.parse(a.begin) - Date.parse(b.begin));
  }

  private entryDetail(id: number): CatalogDetail {
    const me = this.viewer();
    const e = this.catalog.find((x) => x.id === id);
    if (!e || (e.withdrawn && e.authorId !== me)) throw new ApiError('Cette Secret Track n’est pas au catalogue.');
    const hunts = new Set(this.entryHunts(e));
    return {
      ...this.entryView(e),
      sessions: this.sessionsOf(e).map((h) => ({
        huntId: h.id,
        name: h.name,
        organizerNickname: this.nick(h.ownerId),
        location: h.location,
        begin: h.begin,
        end: h.end,
        status: h.status,
        teams: this.db.teams.filter((t) => t.huntId === h.id).length,
        startMode: h.startMode,
        interval: h.interval,
        mine: me !== null && this.db.teams.some((t) => t.huntId === h.id && t.members.some((m) => m.hunterId === me)),
      })),
      owned: me !== null && !!this.purchases.get(me)?.has(`hunt:c${id}`),
      openReports: this.reports
        .filter((r) => r.status === 'open' && hunts.has(r.huntId))
        .reverse()
        .slice(0, 10)
        .map((r) => ({ stepOrder: this.db.steps.find((s) => s.id === r.stepId)!.order, category: r.category, at: r.at })),
      myPlays: this.db.hunts
        .filter((h) => h.catalogId === id && h.surprise && h.hostId !== null)
        .flatMap((h) => this.db.teams.filter((t) => t.huntId === h.id && t.members.some((m) => m.hunterId === me)).map((t) => ({ huntId: h.id, started: t.started, finished: t.finished, until: h.end })))
        .reverse(),
      sample: { order: e.sampleOrder, text: e.sample },
      reviews: this.ratings
        .filter((r) => hunts.has(r.huntId) && r.rating.comment)
        .reverse()
        .map((r) => ({ nickname: this.nick(r.hunterId), stars: r.rating.stars, comment: r.rating.comment!, at: r.at })),
      versions: this.catalog
        .filter((x) => x.parentId === id && (!x.withdrawn || x.authorId === me))
        .map((x) => ({ id: x.id, title: x.title, authorNickname: this.nick(x.authorId), published: x.published, withdrawn: x.withdrawn })),
      huntId: e.authorId === me ? e.huntId : null,
    };
  }

  /** Démonstration : la chasse close de Camille est au catalogue, avec quelques avis de ses joueurs. */
  private seedCatalog(): void {
    const closed = this.db.hunts.find((h) => h.status === 'closed');
    if (!closed) return;
    // Sa photo de départ : la couverture de sa carte dans Explorer (§ 49).
    const start = this.db.steps.find((s) => s.huntId === closed.id && s.order === 0);
    if (start) {
      this.refPhotos.set(
        start.id,
        'data:image/svg+xml;base64,' +
          btoa(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225"><rect width="400" height="225" fill="#8ecae6"/>' +
              '<circle cx="320" cy="55" r="26" fill="#ffd166"/><rect y="150" width="400" height="75" fill="#e9c46a"/>' +
              '<path d="M0 150 Q100 120 200 150 T400 150 V160 H0Z" fill="#219ebc"/><rect x="60" y="95" width="70" height="55" fill="#fff"/>' +
              '<path d="M55 95 L95 65 L135 95Z" fill="#e76f51"/></svg>',
          ),
      );
      start.referencePhoto = true;
    }
    try {
      // Chasse payante de la démo (§ 20) : 3,99 € reversés à son autrice, moins la commission.
      this.publish(closed, { summary: '', travel: 'walk', difficulty: 'medium', durationMinutes: 75, sampleOrder: 1, changes: null, price: 399, practical: ['toilets'], audience: ['friends', 'group'], setting: 'outdoor' });
    } catch {
      return; // jeu de démonstration incomplet : catalogue vide
    }
    const players = this.db.teams.filter((t) => t.huntId === closed.id).flatMap((t) => t.members.map((m) => m.hunterId));
    const comments = ['Énigmes malignes, parcours superbe au bord de l’eau.', null, 'Un joker un peu trop facile, mais quelle ambiance !'];
    players.slice(0, 3).forEach((hunterId, i) =>
      this.ratings.push({
        huntId: closed.id,
        hunterId,
        rating: { stars: 5 - (i % 2), riddles: 4 + (i % 2), route: 5, mood: 4, comment: comments[i] ?? null, organizer: 5 },
        at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
      }),
    );
  }

  /**
   * Jouer en autonomie (§ 13.5) : une chasse géolocalisée de Camille au catalogue, déjà jouée
   * en autonomie par trois joueurs (le classement de la fiche).
   */
  private seedAutonomy(): void {
    const plan = demoPlan({ lat: 43.6108, lng: 3.8767 }, 4, 'l’Écusson');
    const day = 86_400_000;
    const begin = Date.now() - 40 * day;
    const h: MockDb['hunts'][number] = {
      id: this.nextId(this.db.hunts),
      ownerId: 2,
      name: 'Les secrets de l’Écusson',
      description: 'Deux heures dans les ruelles du vieux Montpellier : fontaines, statues et cadrans solaires, à votre rythme.',
      location: 'Montpellier, l’Écusson',
      begin: new Date(begin).toISOString(),
      end: new Date(begin + 3 * 3_600_000).toISOString(),
      started: new Date(begin).toISOString(),
      closed: new Date(begin + 3 * 3_600_000).toISOString(),
      autoStart: false,
      autoClose: true,
      award: 'Une glace place de la Comédie',
      startMode: 'mass',
      interval: null,
      hintPenalties: [2, 5, 10],
      skipPenalty: 15,
      validation: 'geo',
      geoRadius: 40,
      generated: false,
      surprise: false,
      travel: 'walk',
      skin: 'aventure',
      tools: [...DEFAULT_TOOLS],
      difficulty: 'easy',
      durationMinutes: 90,
      hostId: null,
      catalogId: null,
      selfPaced: true,
      teamGame: true,
      teamMin: 1,
      teamMax: 6,
      isPublic: false,
      joinCode: randomToken(6).toUpperCase(),
      contribution: 0,
      startText: plan.startText,
      status: 'closed',
    };
    this.db.hunts.push(h);
    plan.steps.forEach((p, order) =>
      this.db.steps.push({ ...this.blankStep(h.id, order, p.title), arrival: p.arrival, instructions: p.instructions, hints: p.hints, latitude: p.latitude, longitude: p.longitude, address: p.address }),
    );
    let entry: MockEntry;
    try {
      entry = this.publish(h, { summary: h.description, travel: 'walk', difficulty: 'easy', durationMinutes: 90, sampleOrder: 1, changes: null, price: 0, practical: ['stroller', 'toilets', 'cafe'], minAge: 6, audience: ['family', 'couple', 'solo'], setting: 'outdoor' });
    } catch {
      return;
    }
    // Trois parties en autonomie déjà jouées : Léa, Hugo et Jade en famille ; Hugo et Jade prennent
    // un joker sur la même énigme, que l'analyse des étapes (§ 43) fait ressortir.
    for (const [hunterId, minutes, hints, daysAgo, family] of [
      [3, 84, 0, 12, 0],
      [4, 97, 1, 6, 0],
      [7, 71, 1, 3, 2],
    ] as const) {
      const play = this.instantiate(entry, hunterId, true);
      const team = this.addTeam(play, this.nick(hunterId), hunterId, false);
      for (let i = 0; i < family; i++) team.members.push({ hunterId: 11 + i, nickname: this.nick(11 + i) });
      const start = Date.now() - daysAgo * day;
      const steps = this.stepsOf(play.id).filter((s) => s.order > 0);
      team.started = new Date(start).toISOString();
      steps.forEach((s, i) =>
        this.db.validations.push({ teamId: team.id, stepId: s.id, hunterId, source: 'GEO', at: new Date(start + ((i + 1) * minutes * 60_000) / steps.length).toISOString() }),
      );
      team.finished = new Date(start + minutes * 60_000).toISOString();
      if (hints) this.db.hintUses.push({ teamId: team.id, stepId: this.stepsOf(play.id)[1].id, level: 1, hunterId, at: new Date(start + 20 * 60_000).toISOString() });
      Object.assign(play, { status: 'closed', started: team.started, closed: team.finished });
      // Hugo signale des travaux à la deuxième étape (§ 22).
      if (hunterId === 4) {
        const step = this.stepsOf(play.id).find((s) => s.order === 2)!;
        this.reports.push({ id: this.reports.length + 1, huntId: play.id, stepId: step.id, hunterId, category: 'works', message: 'Palissade de chantier devant la statue : on la devine à peine.', status: 'open', at: new Date(start + 50 * 60_000).toISOString(), resolvedAt: null });
      }
    }
  }

  /* ---------- Preuve par photo (§ 12) ---------- */

  /* ---------- Boutique (§ 16) ---------- */

  private readonly purchases = new Map<number, Set<string>>();

  private storeFor(me: number | null): StoreItem[] {
    const owned = (me !== null && this.purchases.get(me)) || new Set<string>();
    return [...PRODUCTS.map((p) => ({ ...p, owned: owns(owned, p.id) })), ...this.creations.products(me)];
  }

  /* ---------- Signalements et statistiques d'étape (§ 22) ---------- */

  private readonly reports: { id: number; huntId: number; stepId: number; hunterId: number; category: ReportCategory; message: string | null; status: 'open' | 'resolved'; at: string; resolvedAt: string | null }[] = [];

  private reportView(r: MockHuntApi['reports'][number]): StepReport {
    const step = this.db.steps.find((s) => s.id === r.stepId)!;
    return { id: r.id, huntId: r.huntId, stepOrder: step.order, stepTitle: step.title, category: r.category, message: r.message, nickname: this.nick(r.hunterId), status: r.status, at: r.at, resolvedAt: r.resolvedAt };
  }

  private sortedReports(list: MockHuntApi['reports']): StepReport[] {
    return [...list].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.id - a.id).map((r) => this.reportView(r));
  }

  reportStep(huntId: number, data: { stepOrder: number; category: ReportCategory; message: string | null }): Observable<StepReport> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.playState(huntId);
      const reachable = state.clue ? state.clue.targetOrder : state.team.finished ? state.totalSteps : 0;
      if (data.stepOrder < 1 || data.stepOrder > reachable) throw new ApiError('Signalez une étape que vous avez atteinte ou que vous cherchez.');
      const step = this.stepsOf(huntId).find((s) => s.order === data.stepOrder)!;
      const r = { id: this.reports.length + 1, huntId, stepId: step.id, hunterId: me, category: data.category, message: data.message?.trim() || null, status: 'open' as const, at: new Date().toISOString(), resolvedAt: null };
      this.reports.push(r);
      return this.reportView(r);
    });
  }

  huntReports(huntId: number): Observable<StepReport[]> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      return this.sortedReports(this.reports.filter((r) => r.huntId === huntId));
    });
  }

  catalogReports(catalogId: number): Observable<StepReport[]> {
    return this.reply(() => {
      const hunts = new Set(this.entryHunts(this.authoredEntry(catalogId)));
      return this.sortedReports(this.reports.filter((r) => hunts.has(r.huntId)));
    });
  }

  resolveReport(reportId: number, resolved: boolean): Observable<StepReport> {
    return this.reply(() => {
      const me = this.requireUser();
      const r = this.reports.find((x) => x.id === reportId);
      const hunt = r && this.db.hunts.find((h) => h.id === r.huntId);
      const author = !!r && this.catalog.some((e) => e.authorId === me && this.entryHunts(e).includes(r.huntId));
      if (!r || !hunt || (hunt.ownerId !== me && !author)) throw new ApiError('Signalement introuvable.');
      Object.assign(r, { status: resolved ? 'resolved' : 'open', resolvedAt: resolved ? new Date().toISOString() : null });
      return this.reportView(r);
    });
  }

  huntStats(huntId: number): Observable<HuntStats> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      return stepStats([this.playData(huntId)], new Map(this.stepsOf(huntId).map((s) => [s.order, s.title])));
    });
  }

  catalogStats(catalogId: number): Observable<HuntStats> {
    return this.reply(() => {
      const e = this.authoredEntry(catalogId);
      return stepStats(this.entryHunts(e).map((id) => this.playData(id)), new Map(e.content.steps.map((s) => [s.order, s.title])));
    });
  }

  private playData(huntId: number): PlayData {
    const h = this.db.hunts.find((x) => x.id === huntId)!;
    const teams = this.db.teams.filter((t) => t.huntId === huntId);
    const ids = new Set(teams.map((t) => t.id));
    return {
      over: h.status === 'closed' || h.status === 'archived',
      orderOf: new Map(this.stepsOf(huntId).map((s) => [s.id, s.order])),
      teams,
      validations: this.db.validations.filter((v) => ids.has(v.teamId)),
      hints: this.db.hintUses.filter((u) => ids.has(u.teamId)),
    };
  }

  private authoredEntry(catalogId: number): MockEntry {
    const e = this.catalog.find((x) => x.id === catalogId);
    if (!e) throw new ApiError('Cette Secret Track n’est pas au catalogue.');
    if (e.authorId !== this.requireUser()) throw new ApiError('Réservé à l’auteur de la Secret Track.');
    return e;
  }

  /* ---------- Chasse sur mesure payante (§ 21) ---------- */

  /** Droits achetés : crédits et fin du forfait. Seb est membre fondateur dans la maquette. */
  private readonly genRights = new Map<number, { credits: number; passUntil: number | null }>();
  private readonly genUses: { hunterId: number; at: number; right: GenerationRight }[] = [];

  private access(me: number): GenerationAccess {
    const rights = this.genRights.get(me) ?? { credits: 0, passUntil: null };
    const uses = this.genUses.filter((u) => u.hunterId === me);
    const since = (ms: number) => uses.filter((u) => u.at > Date.now() - ms);
    // Chasses partagées par le joueur, jouées jusqu'au bout par d'autres.
    const sharedPlayed = this.catalog.filter(
      (e) => e.authorId === me && this.db.hunts.some((h) => h.catalogId === e.id && h.status === 'closed' && h.ownerId !== me && h.hostId !== me),
    ).length;
    const bonus = creatorBonus(sharedPlayed);
    const used = uses.filter((u) => u.right === 'credit').length;
    const base = {
      paid: true,
      founder: me === FOUNDER_ID,
      passUntil: rights.passUntil ? new Date(rights.passUntil).toISOString() : null,
      credits: { purchased: rights.credits, bonus, used, available: Math.max(0, rights.credits + bonus - used) },
      sharedPlayed,
      usage: { today: since(86_400_000).length, daily: GENERATION_LIMITS.daily, passPeriod: since(30 * 86_400_000).filter((u) => u.right === 'pass').length, passMonthly: GENERATION_LIMITS.passMonthly },
    };
    return { ...base, ...pickRight(base) };
  }

  generationAccess(): Observable<GenerationAccess> {
    return this.reply(() => this.access(this.requireUser()));
  }

  /* ---------- Paiement (§ 20), simulé : le paiement réussit aussitôt ---------- */

  private readonly payouts = new Map<number, { ready: boolean }>([[2, { ready: true }]]);

  private sellable(productId: string): { price: number; sellerId: number | null } | null {
    const hunt = /^hunt:c(\d+)$/.exec(productId);
    if (hunt) {
      const e = this.catalog.find((x) => x.id === Number(hunt[1]) && !x.withdrawn);
      return e ? { price: e.price, sellerId: e.authorId } : null;
    }
    const ref = creationRef(productId);
    if (ref !== null) {
      const c = this.creations.published(ref);
      return c && creationProductId(c.kind, c.id) === productId ? { price: c.price, sellerId: c.authorId } : null;
    }
    const p = productById(productId);
    return p ? { price: p.included ? 0 : p.price, sellerId: null } : null;
  }

  checkout(productId: string, returnPath: string): Observable<CheckoutResult> {
    return this.reply(() => {
      const me = this.requireUser();
      // Chasse sur mesure (§ 21) : crédit ou forfait, accordé aussitôt (paiement simulé).
      const offer = generationOffer(productId);
      if (offer) {
        const rights = this.genRights.get(me) ?? { credits: 0, passUntil: null };
        if (offer.credits) rights.credits += offer.credits;
        else rights.passUntil = Math.max(Date.now(), rights.passUntil ?? 0) + offer.days! * 86_400_000;
        this.genRights.set(me, rights);
        return { url: `${returnPath}${returnPath.includes('?') ? '&' : '?'}paid=1&product=${encodeURIComponent(productId)}`, items: [] };
      }
      const sale = this.sellable(productId);
      if (!sale) throw new ApiError('Produit inconnu.');
      const owned = this.purchases.get(me) ?? new Set<string>();
      this.purchases.set(me, owned);
      const free = sale.price === 0 || sale.sellerId === me || owned.has(productId);
      if (!productById(productId)?.included) owned.add(productId);
      if (free) return { url: null, items: this.storeFor(me) };
      // Au lieu de la page Stripe : retour direct, paiement « confirmé ».
      return { url: `${returnPath}${returnPath.includes('?') ? '&' : '?'}paid=1&product=${encodeURIComponent(productId)}`, items: [] };
    });
  }

  payoutAccount(): Observable<PayoutAccount> {
    return this.reply(() => {
      const a = this.payouts.get(this.requireUser());
      return { enabled: true, account: !!a, ready: !!a?.ready, commissionPercent: 20 };
    });
  }

  startPayouts(returnPath: string): Observable<{ url: string }> {
    return this.reply(() => {
      this.payouts.set(this.requireUser(), { ready: true });
      return { url: `${returnPath}${returnPath.includes('?') ? '&' : '?'}stripe=retour` };
    });
  }

  /* ---------- Créations de la communauté (§ 19) ---------- */

  private readonly creations = new MockCreations((id) => this.nick(id), this.purchases);
  /** Relecteur de la maquette : Seb. */
  private isReviewer(me: number): boolean {
    return me === REVIEWER_ID;
  }

  myCreations(): Observable<Creation[]> {
    return this.reply(() => this.creations.mine(this.requireUser()));
  }
  createCreation(data: CreationInput): Observable<Creation> {
    return this.reply(() => this.creations.create(this.requireUser(), data));
  }
  updateCreation(id: number, data: Partial<Omit<CreationInput, 'kind'>>): Observable<Creation> {
    return this.reply(() => this.creations.update(this.requireUser(), id, data));
  }
  deleteCreation(id: number): Observable<void> {
    return this.reply(() => this.creations.remove(this.requireUser(), id));
  }
  submitCreation(id: number): Observable<Creation> {
    return this.reply(() => this.creations.submit(this.requireUser(), id));
  }
  withdrawCreation(id: number): Observable<Creation> {
    return this.reply(() => this.creations.withdraw(this.requireUser(), id));
  }
  reviewQueue(): Observable<Creation[]> {
    return this.reply(() => this.creations.queue(this.isReviewer(this.requireUser())));
  }
  reviewCreation(id: number, approve: boolean, note: string | null): Observable<Creation> {
    return this.reply(() => {
      const me = this.requireUser();
      return this.creations.review(me, this.isReviewer(me), id, approve, note);
    });
  }
  packPuzzles(id: number): Observable<Puzzle[]> {
    return this.reply(() => {
      const me = this.requireUser();
      return this.creations.puzzles(me, this.isReviewer(me), id);
    });
  }
  getCreator(id: number): Observable<CreatorPage> {
    return this.reply(() => this.creations.creator(id, this.db.hunters.some((h) => h.id === id)));
  }
  creatorSkin(id: string): Observable<SkinManifest> {
    return this.reply(() => this.creations.skin(id));
  }

  getStore(): Observable<StoreItem[]> {
    return this.reply(() => this.storeFor(this.viewer()));
  }

  acquire(productId: string): Observable<StoreItem[]> {
    return this.reply(() => {
      const me = this.requireUser();
      const ref = creationRef(productId);
      const creation = ref !== null ? this.creations.published(ref) : undefined;
      const product = creation && productId === creationProductId(creation.kind, creation.id) ? { id: productId, included: false } : productById(productId);
      if (!product) throw new ApiError('Extension inconnue.');
      const sale = this.sellable(productId);
      if (sale && sale.price > 0 && sale.sellerId !== me) throw new ApiError('Ce produit est payant : passez par le paiement.');
      if (!product.included) {
        const owned = this.purchases.get(me) ?? new Set<string>();
        owned.add(product.id);
        this.purchases.set(me, owned);
      }
      return this.storeFor(me);
    });
  }

  /** Adresses fictives disposées autour du joueur, quelques-unes par catégorie. */
  /** Centres d'intérêt par équipe (§ 46), le temps de la session de maquette. */
  private readonly interests = new Map<number, GuideInterest[]>();

  understand(req: GuideRequest): Observable<GuideUnderstanding> {
    return this.reply(() => {
      this.requireUser();
      return demoUnderstanding(req);
    });
  }

  setInterests(huntId: number, interests: GuideInterest[]): Observable<GuideInterest[]> {
    return this.reply(() => {
      const me = this.requireUser();
      const team = this.db.teams.find((t) => t.huntId === huntId && t.members.some((m) => m.hunterId === me));
      if (!team) throw new ApiError('Vous ne jouez pas cette Secret Track.');
      const clean = interests.filter((i) => i.label.trim() && i.filters.length).slice(0, GUIDE_MAX_INTERESTS);
      this.interests.set(team.id, clean);
      return clean;
    });
  }

  nearby(pos: { lat: number; lng: number }, radius: number, huntId?: number): Observable<NearbyResult> {
    return this.reply(() => {
      const me = this.requireUser();
      const team = huntId ? this.db.teams.find((t) => t.huntId === huntId && t.members.some((m) => m.hunterId === me)) : undefined;
      const interests = team ? (this.interests.get(team.id) ?? []) : [];
      const samples: [string, string | null, string, string | null][] = [
        ['snack', 'Boulangerie des Halles', 'Boulangerie', 'lun-sam 7h-19h30 · dim 7h-13h'],
        ['snack', 'Glacier Pinguino', 'Glacier', 'tous les jours 11h-23h'],
        ['snack', 'Café de la Comédie', 'Café', null],
        ['food', 'La Table du Marché', 'Restaurant', 'mar-sam 12h-14h, 19h-22h'],
        ['food', 'Crêperie Bretonne', 'Restaurant', null],
        [interests.length ? 'interest-0' : 'shops', 'Run & Co', 'Chaussures', 'lun-sam 10h-19h'],
        ['shops', 'Librairie Sauramps', 'Librairie', 'lun-sam 10h-19h30'],
        ['shops', 'Le Jouet Rouge', 'Jouets', null],
        ['toilets', null, 'Toilettes', null],
        ['pharmacy', 'Pharmacie de la Place', 'Pharmacie', 'lun-sam 8h30-20h'],
        ['water', null, 'Point d’eau potable', null],
        ['playground', 'Square des Enfants', 'Aire de jeux', null],
      ];
      const places: NearbyPlace[] = samples
        .map(([category, name, kind, hours], i) => {
          const distance = Math.round(Math.min(radius, 60 + i * 37));
          const angle = i * 2.4;
          return {
            id: `n${900 + i}`,
            name,
            category,
            kind,
            lat: pos.lat + (Math.sin(angle) * distance) / 111_195,
            lng: pos.lng + (Math.cos(angle) * distance) / (111_195 * Math.cos((pos.lat * Math.PI) / 180)),
            distance,
            hours,
            address: name ? `${3 + i} rue de la Loge` : null,
          };
        })
        .sort((a, b) => a.distance - b.distance);
      const categories: NearbyCategory[] = [
        ...interests.map((i, n) => ({ id: `interest-${n}`, label: i.label, icon: 'favorite' })),
        ...NEARBY_CATEGORIES.map(({ id, label, icon }) => ({ id, label, icon })),
      ];
      return { radius, categories, places };
    });
  }

  compass(huntId: number, pos: { lat: number; lng: number }): Observable<CompassReading> {
    return this.reply(() => {
      const state = this.playState(huntId);
      if (!state.hunt.tools.includes('compass')) throw new ApiError('Cette Secret Track n’a pas de boussole.');
      if (!state.clue) throw new ApiError('Aucune étape à trouver pour le moment.');
      const target = this.stepsOf(huntId).find((s) => s.order === state.clue!.targetOrder)!;
      if (target.latitude === null || target.longitude === null) throw new ApiError('Ce lieu n’est pas placé sur la carte : la boussole ne peut pas le trouver.');
      const to = { lat: target.latitude, lng: target.longitude };
      return compassReading(pos, to, distanceMeters(pos, to));
    });
  }

  /** Comme le serveur : seulement les extensions obtenues, sauf ce que la chasse a déjà. */
  private checkExtensions(me: number, data: Partial<Hunt>, current: MockDb['hunts'][number] | null): void {
    const owned = this.purchases.get(me) ?? new Set<string>();
    const wanted = [
      ...(data.skin !== undefined && data.skin !== current?.skin ? [`skin:${data.skin}`] : []),
      ...(data.tools ?? []).filter((t) => !current?.tools.includes(t)).map((t) => `tool:${t}`),
    ];
    for (const id of wanted) {
      const ref = creationRef(id);
      if (ref !== null) {
        const c = this.creations.published(ref);
        if (!c || creationProductId(c.kind, c.id) !== id) throw new ApiError('Ce skin n’existe pas ou n’est plus publié.');
        if (c.authorId !== me && !owned.has(id)) throw new ApiError(`« ${c.name} » s’obtient d’abord dans la boutique.`);
        continue;
      }
      const p = productById(id);
      if (p && !owns(owned, p.id)) throw new ApiError(`« ${p.name} » s’obtient d’abord dans la boutique.`);
    }
  }

  getFeatures(): Observable<Features> {
    // La maquette montre le paiement activé, simulé (§ 20).
    return this.reply(() => ({ photos: true, generation: true, payments: true, assist: true, guide: true }));
  }

  /* ---------- Assistant de rédaction (§ 25), simulé ---------- */

  /** Suggestions déjà utilisées : une douzaine pour Camille (formule de base), pour que le décompte parle en maquette. */
  private readonly assists = new Map<number, { action: AssistAction; at: string }[]>([
    [
      2,
      (['rephrase', 'hints', 'review', 'rephrase', 'easier', 'hints', 'review', 'rephrase', 'harder', 'hints', 'rephrase', 'review'] as AssistAction[]).map((action, i) => ({
        action,
        at: new Date(Date.now() - (27 - i * 2.2) * 86_400_000).toISOString(),
      })),
    ],
  ]);

  private assistUsageOf(me: number): AssistUsage {
    const plan: AssistPlan = me === FOUNDER_ID ? 'founder' : (this.genRights.get(me)?.passUntil ?? 0) > Date.now() ? 'pass' : 'base';
    return assistUsage(this.assists.get(me) ?? [], plan);
  }

  assistUsage(): Observable<AssistUsage> {
    return this.reply(() => this.assistUsageOf(this.requireUser()));
  }

  assist(stepId: number, req: AssistRequest): Observable<AssistReply> {
    return this.reply(() => {
      const me = this.requireUser();
      const step = this.db.steps.find((s) => s.id === stepId);
      if (!step) throw new ApiError('Étape introuvable.');
      this.ownedHunt(step.huntId);
      if (!this.stepsOf(step.huntId).some((s) => s.order === step.order + 1)) throw new ApiError('L’arrivée n’a pas d’énigme : il n’y a plus de lieu à trouver.');
      const text = req.instructions.trim();
      if (!text && req.action !== 'rephrase') throw new ApiError('Écrivez d’abord une première version de l’énigme.');
      const usage = this.assistUsageOf(me);
      if (usage.blocked) throw new ApiError(usage.blocked);
      const suggestion: AssistSuggestion = { action: req.action, instructions: null, hints: null, review: null };
      const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
      switch (req.action) {
        case 'rephrase':
          suggestion.instructions = text
            ? `${first} Ouvrez l’œil : ce que vous cherchez ne se cache pas, il attend qu’on le remarque.`
            : 'Quittez ce lieu par où le soleil se lève. Au bout de la rue, là où les passants s’arrêtent pour lever les yeux, votre prochain indice vous attend.';
          break;
        case 'easier':
          suggestion.instructions = `${text} Petit coup de pouce : c’est à moins de cinq minutes à pied, et on le voit de loin.`;
          break;
        case 'harder':
          suggestion.instructions = `${first.replace(/[.!?]$/, '')}… mais seuls ceux qui lisent les murs sauront où s’arrêter.`;
          break;
        case 'hints':
          suggestion.hints = ['Regardez vers le haut plutôt que vers le sol.', 'Le lieu porte un nom lié à l’eau.', 'Cherchez la plus grande place du quartier, côté fontaine.'];
          break;
        case 'review':
          suggestion.review = '- « La grande porte » peut désigner deux lieux du quartier : précisez lequel.\n- L’énigme se lit bien sinon.';
          suggestion.instructions = `${text} (Celle qui fait face au jardin.)`;
          break;
        case 'diagnose':
          suggestion.review =
            '- Les équipes prennent un joker ici bien plus qu’ailleurs : l’énigme évoque « la fontaine », or il y en a deux sur la place.\n- Le temps passé (trois fois le prévu) montre qu’elles cherchent au mauvais endroit, pas qu’elles marchent loin.';
          suggestion.instructions = `${first.replace(/[.!?]$/, '')} : pas celle du marché, mais celle qui chante sous les platanes.`;
          break;
      }
      const list = this.assists.get(me) ?? [];
      list.push({ action: req.action, at: new Date().toISOString() });
      this.assists.set(me, list);
      return { suggestion, usage: this.assistUsageOf(me) };
    });
  }

  /** Arbitre simulé : la première photo d'une étape n'est pas reconnue, les suivantes le sont. */
  submitPhoto(huntId: number, image: string): Observable<PhotoResult> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.playState(huntId);
      if (state.hunt.validation !== 'qr') throw new ApiError('Cette Secret Track se valide par géolocalisation : appuyez sur « Je suis arrivé ».');
      if (!state.clue) throw new ApiError('Aucune étape à trouver pour le moment.');
      const step = this.stepsOf(huntId).find((s) => s.order === state.clue!.targetOrder)!;
      const tried = this.photos.some((p) => p.teamId === state.team.id && p.stepId === step.id);
      const photo: MockPhoto = {
        id: this.photos.length + 1,
        teamId: state.team.id,
        stepId: step.id,
        hunterId: me,
        image,
        at: new Date().toISOString(),
        verdict: tried ? 'match' : 'nomatch',
        reason: tried ? 'Le lieu est bien reconnu.' : 'La photo ne semble pas montrer le lieu de l’énigme.',
        insisted: false,
        counted: false,
        review: null,
      };
      this.photos.push(photo);
      if (tried) this.validateByPhoto(photo, me);
      return { photo: this.photoView(photo), state: this.playState(huntId) };
    });
  }

  insistPhoto(photoId: number): Observable<PhotoResult> {
    return this.reply(() => {
      const me = this.requireUser();
      const photo = this.photos.find((p) => p.id === photoId);
      const team = photo && this.db.teams.find((t) => t.id === photo.teamId);
      if (!photo || !team || !team.members.some((m) => m.hunterId === me)) throw new ApiError('Photo introuvable.');
      if (photo.counted) throw new ApiError('Cette photo a déjà validé l’étape.');
      const state = this.playState(team.huntId);
      const step = this.stepsOf(team.huntId).find((s) => s.id === photo.stepId)!;
      if (state.clue?.targetOrder !== step.order) throw new ApiError('Cette photo ne concerne plus l’énigme en cours.');
      photo.insisted = true;
      this.validateByPhoto(photo, me);
      return { photo: this.photoView(photo), state: this.playState(team.huntId) };
    });
  }

  huntPhotos(huntId: number): Observable<PhotoAttempt[]> {
    return this.reply(() => {
      this.ownedHunt(huntId);
      return this.photosOf(huntId);
    });
  }

  reviewPhoto(photoId: number, approve: boolean): Observable<PhotoAttempt[]> {
    return this.reply(() => {
      const photo = this.photos.find((p) => p.id === photoId);
      const team = photo && this.db.teams.find((t) => t.id === photo.teamId);
      if (!photo || !team) throw new ApiError('Photo introuvable.');
      this.ownedHunt(team.huntId);
      if (!photo.counted) throw new ApiError('Cette photo n’a pas validé d’étape : rien à contrôler.');
      if (photo.review) throw new ApiError('Cette photo a déjà été contrôlée.');
      photo.review = approve ? 'approved' : 'rejected';
      if (!approve) {
        const steps = this.stepsOf(team.huntId);
        const val = this.db.validations.find((v) => v.teamId === team.id && v.stepId === photo.stepId)!;
        if (steps.find((s) => s.id === photo.stepId)!.order === finalOrder(steps)) {
          this.db.validations = this.db.validations.filter((v) => v !== val);
          team.finished = null;
        } else {
          val.source = 'SKIP';
        }
      }
      return this.photosOf(team.huntId);
    });
  }

  photoImage(photoId: number): Observable<Blob> {
    return this.blob(() => this.photos.find((p) => p.id === photoId)?.image ?? null);
  }

  referenceImage(stepId: number): Observable<Blob> {
    return this.blob(() => this.refPhotos.get(stepId) ?? null);
  }

  /** Photo du lieu montrée aux joueurs (§ 18), comme le serveur. */
  private illustration(step: Step | undefined, moment: PhotoShow): number | null {
    if (!step?.referencePhoto || !step.photoShow) return null;
    return moment === 'clue' && step.photoShow !== 'clue' ? null : step.id;
  }
  private illustrationCredit(step: Step | undefined, moment: PhotoShow): PhotoCredit | null {
    return this.illustration(step, moment) !== null ? (step?.photoCredit ?? null) : null;
  }


  illustrationImage(stepId: number): Observable<Blob> {
    return this.blob(() => {
      const step = this.db.steps.find((s) => s.id === stepId);
      if (!step) return null;
      const hunt = this.db.hunts.find((h) => h.id === step.huntId);
      const me = this.viewer();
      let allowed = hunt?.ownerId === me;
      if (!allowed && step.photoShow && me !== null && this.teamOf(step.huntId, me)) {
        const state = this.playState(step.huntId);
        allowed = state.validated.some((v) => v.illustration === step.id) || state.clue?.illustration === step.id;
      }
      return allowed ? (this.refPhotos.get(stepId) ?? null) : null;
    });
  }

  setReferencePhoto(stepId: number, image: string | null): Observable<Step> {
    return this.reply(() => {
      const step = this.db.steps.find((s) => s.id === stepId);
      if (!step) throw new ApiError('Étape introuvable.');
      this.ownedHunt(step.huntId);
      if (image === null) this.refPhotos.delete(stepId);
      else this.refPhotos.set(stepId, image);
      step.referencePhoto = image !== null;
      return step;
    });
  }

  /** La maquette ne télécharge rien : elle vérifie le lien comme le serveur, puis garde une image d'exemple. */
  setReferencePhotoUrl(stepId: number, url: string): Observable<Step> {
    return this.reply(() => {
      const step = this.db.steps.find((s) => s.id === stepId);
      if (!step) throw new ApiError('Étape introuvable.');
      this.ownedHunt(step.huntId);
      if (!/^https:\/\/[^/\s]+\.[^/\s]+\//.test(url.trim())) throw new ApiError('Seuls les liens sécurisés (https://) vers un site sont acceptés.');
      this.refPhotos.set(stepId, MOCK_LINKED_PHOTO);
      step.referencePhoto = true;
      step.photoCredit = null;
      return step;
    });
  }

  /** Propositions de la maquette : trois images d'exemple, avec un crédit fictif. */
  photoProposals(stepId: number): Observable<PhotoProposal[]> {
    return this.reply(() => {
      const step = this.db.steps.find((s) => s.id === stepId);
      if (!step) throw new ApiError('Étape introuvable.');
      this.ownedHunt(step.huntId);
      return MOCK_PROPOSALS.map(([title, a, b], i) => ({
        title,
        preview: mockGradient(a, b),
        credit: { text: `Photo : Contributeur ${i + 1} · CC BY-SA 4.0 · Wikimedia Commons`, url: 'https://commons.wikimedia.org/' },
      }));
    });
  }

  setReferencePhotoCommons(stepId: number, title: string): Observable<Step> {
    return this.reply(() => {
      const step = this.db.steps.find((s) => s.id === stepId);
      if (!step) throw new ApiError('Étape introuvable.');
      this.ownedHunt(step.huntId);
      const i = MOCK_PROPOSALS.findIndex(([t]) => t === title);
      if (i < 0) throw new ApiError('Photo inconnue.');
      this.refPhotos.set(stepId, mockGradient(MOCK_PROPOSALS[i][1], MOCK_PROPOSALS[i][2]));
      step.referencePhoto = true;
      step.photoCredit = { text: `Photo : Contributeur ${i + 1} · CC BY-SA 4.0 · Wikimedia Commons`, url: 'https://commons.wikimedia.org/' };
      return step;
    });
  }

  private validateByPhoto(photo: MockPhoto, me: number): void {
    photo.counted = true;
    this.arrive(photo.teamId, this.db.steps.find((s) => s.id === photo.stepId)!, me, 'PHOTO');
  }

  /* ---------- Version anglaise (§ 33), simulée ---------- */

  /** La maquette « traduit » en marquant le texte : de quoi voir ce que le serveur traduirait. */
  translate(req: { lang: 'en'; hunt?: number; catalog?: number[]; info?: number[] }): Observable<Record<string, string>> {
    return this.reply(() => {
      const texts = new Set<string>();
      const add = (t: string | null | undefined) => t?.trim() && texts.add(t.trim());
      for (const id of req.catalog ?? []) {
        const e = this.catalog.find((x) => x.id === id);
        if (e) [e.title, e.summary, e.sample, e.location].forEach(add);
      }
      for (const id of req.info ?? []) {
        const h = this.db.hunts.find((x) => x.id === id);
        if (h) [h.name, h.location, h.description, h.startText, h.award].forEach(add);
      }
      if (req.hunt) {
        const state = this.playState(req.hunt);
        [state.hunt.name, state.hunt.location, state.hunt.description, state.start?.name].forEach(add);
        for (const v of state.validated) [v.title, v.arrival].forEach(add);
        if (state.clue) [state.clue.instructions, ...state.clue.hintsRevealed].forEach(add);
        if (state.puzzle) [state.puzzle.title, state.puzzle.puzzle.prompt, state.puzzle.puzzle.hint].forEach(add);
      }
      return Object.fromEntries([...texts].map((t) => [t, `[EN] ${t}`]));
    });
  }

  /* ---------- Hors ligne (§ 32), comme le serveur ---------- */

  private readonly offlineDone = new Set<string>();

  getOfflinePack(huntId: number): Observable<OfflinePack> {
    return defer(async () => {
      const me = this.requireUser();
      const h = this.visibleHunt(huntId);
      const team = this.teamOf(huntId, me);
      if (!team) throw new ApiError('Vous n’êtes pas inscrit à cette Secret Track.');
      if (h.status !== 'published' && h.status !== 'running') throw new ApiError('Cette expédition n’est pas en cours.');
      if (!team.started && !(h.surprise && h.selfPaced)) throw new ApiError('Préparez le hors ligne une fois le départ donné.');
      const steps = this.stepsOf(huntId);
      const vals = this.db.validations.filter((v) => v.teamId === team.id);
      const hints: Record<number, number> = {};
      for (const u of this.db.hintUses.filter((x) => x.teamId === team.id)) hints[u.stepId] = Math.max(hints[u.stepId] ?? 0, u.level);
      const pending = [...this.arrivals.entries()].find(([k]) => k.startsWith(`${team.id}:`));
      const pack: OfflinePack = {
        huntId,
        huntName: h.name,
        skin: h.skin,
        teamName: team.name,
        validation: h.validation,
        geoRadius: h.geoRadius,
        selfStart: canSelfStart(h, team, me) && h.selfPaced,
        steps: await Promise.all(
          steps.map(async (st) => ({
            stepId: st.id,
            order: st.order,
            title: st.title,
            arrival: st.arrival,
            instructions: st.instructions,
            hints: st.hints,
            lat: st.latitude,
            lng: st.longitude,
            entrances: st.entrances,
            tokenHash: h.validation === 'qr' && st.order > 0 && st.token ? await offlineHash(st.id, st.token) : null,
            puzzle: st.puzzle ? publicPuzzle(st.puzzle, st.id) : null,
            answerHashes: st.puzzle ? await Promise.all(acceptedAnswers(st.puzzle).map((a) => offlineHash(st.id, a))) : null,
          })),
        ),
        progress: {
          started: team.started,
          validated: vals.map((v) => ({ order: steps.find((x) => x.id === v.stepId)!.order, at: v.at, skipped: v.source === 'SKIP' })).sort((a, b) => a.order - b.order),
          hints,
          puzzle: pending ? { stepId: Number(pending[0].split(':')[1]), attempts: pending[1].attempts } : null,
        },
        downloaded: new Date().toISOString(),
      };
      return structuredClone(pack);
    }).pipe(delay(LATENCY_MS));
  }

  offlineSync(huntId: number, events: OfflineEvent[]): Observable<OfflineSyncResult & { state: PlayState }> {
    return this.reply(() => {
      const me = this.requireUser();
      const team = this.teamOf(huntId, me);
      if (!team) throw new ApiError('Vous n’êtes pas inscrit à cette Secret Track.');
      let applied = 0;
      let previous = 0;
      let rejected: OfflineSyncResult['rejected'] = null;
      for (const [index, e] of events.entries()) {
        const key = `${team.id}:${e.id}`;
        if (this.offlineDone.has(key)) {
          applied++;
          continue;
        }
        const at = Date.parse(e.at);
        const reason = !Number.isFinite(at) || at > Date.now() + 120_000 ? 'Heure invalide (horloge du téléphone ?).' : at < previous ? 'Actions dans le désordre.' : this.replayOffline(huntId, me, e);
        if (reason) {
          rejected = { index, reason };
          break;
        }
        previous = at;
        this.offlineDone.add(key);
        applied++;
      }
      return { applied, rejected, state: this.playState(huntId) };
    });
  }

  private replayOffline(huntId: number, me: number, e: OfflineEvent): string | null {
    const h = this.visibleHunt(huntId);
    const team = this.teamOf(huntId, me)!;
    if (e.kind === 'start') {
      if (!canSelfStart(h, team, me) || !h.selfPaced) return 'Le départ ne se donne pas depuis ce téléphone.';
      if (h.status === 'published') {
        h.status = 'running';
        h.started = e.at;
      }
      team.started = e.at;
      return null;
    }
    if (!team.started || Date.parse(e.at) < Date.parse(team.started)) return 'Action antérieure au départ de l’équipe.';
    const state = this.playState(huntId);
    const steps = this.stepsOf(huntId);
    const clue = state.clue;
    const target = clue ? steps.find((x) => x.order === clue.targetOrder)! : null;
    switch (e.kind) {
      case 'hint':
        if (!clue || clue.stepId !== e.stepId || clue.hintsRevealed.length >= clue.hintsTotal) return 'Ce joker ne correspond pas à l’énigme en cours.';
        this.db.hintUses.push({ teamId: team.id, stepId: clue.stepId, level: clue.hintsRevealed.length + 1, hunterId: me, at: e.at });
        return null;
      case 'skip':
        if (!clue || !target || target.id !== e.stepId) return 'Cet abandon ne correspond pas à l’épreuve en cours.';
        this.recordSkip(team.id, target, me, e.at);
        return null;
      case 'arrive':
      case 'scan': {
        if (!target || target.id !== e.stepId || state.puzzle) return 'Cette arrivée ne correspond pas au lieu cherché.';
        if (e.kind === 'arrive') {
          const check = arrivalCheck(target, h, e);
          if (!check?.ok) return `Position trop loin du lieu (${check?.distance ?? '?'} m).`;
        } else if (e.token !== target.token) return 'Ce QR code n’est pas celui du lieu cherché.';
        this.arrive(team.id, target, me, e.kind === 'arrive' ? 'GEO' : 'QR', e.at);
        return null;
      }
      case 'answer': {
        if (!state.puzzle || state.puzzle.stepId !== e.stepId) return 'Aucune épreuve n’attendait cette réponse.';
        const step = steps.find((x) => x.id === e.stepId)!;
        if (!checkAnswer(step.puzzle!, e.answer)) return 'Réponse à l’épreuve refusée.';
        const key = `${team.id}:${step.id}`;
        const arrival = this.arrivals.get(key)!;
        this.arrivals.delete(key);
        this.recordValidation(team.id, step, me, arrival.source, e.at);
        return null;
      }
    }
  }

  /* ---------- Énigmes d'arrivée (§ 17) ---------- */

  private readonly arrivals = new Map<string, { source: 'QR' | 'GEO' | 'PHOTO'; attempts: number; hint: boolean }>();

  /** Comme le serveur : sans énigme, l'étape est validée ; avec, l'arrivée attend la bonne réponse. */
  private arrive(teamId: number, step: Step, me: number, source: 'QR' | 'GEO' | 'PHOTO', at?: string): 'validated' | 'puzzle' {
    if (step.puzzle) {
      const key = `${teamId}:${step.id}`;
      this.arrivals.set(key, { attempts: 0, hint: false, ...this.arrivals.get(key), source });
      return 'puzzle';
    }
    this.recordValidation(teamId, step, me, source, at);
    return 'validated';
  }

  private recordValidation(teamId: number, step: Step, me: number, source: 'QR' | 'GEO' | 'PHOTO', at?: string): void {
    const team = this.db.teams.find((t) => t.id === teamId)!;
    const now = at ?? new Date().toISOString();
    this.db.validations.push({ teamId, stepId: step.id, hunterId: me, source, at: now });
    const steps = this.stepsOf(team.huntId);
    if (step.order === finalOrder(steps)) {
      team.finished = now;
      this.closeSurpriseIfAllArrived(this.db.hunts.find((h) => h.id === team.huntId)!);
    }
  }

  solvePuzzle(huntId: number, answer: string): Observable<PuzzleResult> {
    return this.reply(() => {
      const me = this.requireUser();
      const state = this.playState(huntId);
      if (!state.puzzle) throw new ApiError('Aucune énigme à résoudre : rendez-vous d’abord sur le lieu.');
      const steps = this.stepsOf(huntId);
      const step = steps.find((s) => s.id === state.puzzle!.stepId)!;
      const key = `${state.team.id}:${step.id}`;
      const arrival = this.arrivals.get(key)!;
      if (!checkAnswer(step.puzzle!, answer)) {
        arrival.attempts++;
        return { correct: false, step: null, state: this.playState(huntId) } satisfies PuzzleResult;
      }
      this.arrivals.delete(key);
      this.recordValidation(state.team.id, step, me, arrival.source);
      return {
        correct: true,
        step: { order: step.order, title: step.title, arrival: step.arrival, isFinal: step.order === finalOrder(steps) },
        state: this.playState(huntId),
      } satisfies PuzzleResult;
    });
  }

  puzzleHint(huntId: number): Observable<PlayState> {
    return this.reply(() => {
      const state = this.playState(huntId);
      if (!state.puzzle) throw new ApiError('Aucune énigme en cours.');
      this.arrivals.get(`${state.team.id}:${state.puzzle.stepId}`)!.hint = true;
      return this.playState(huntId);
    });
  }

  private photosOf(huntId: number): PhotoAttempt[] {
    const teams = new Set(this.db.teams.filter((t) => t.huntId === huntId).map((t) => t.id));
    return this.photos.filter((p) => teams.has(p.teamId)).map((p) => this.photoView(p));
  }

  private photoView(p: MockPhoto): PhotoAttempt {
    const step = this.db.steps.find((s) => s.id === p.stepId)!;
    return {
      id: p.id,
      teamId: p.teamId,
      teamName: this.db.teams.find((t) => t.id === p.teamId)?.name ?? '',
      stepId: p.stepId,
      stepOrder: step.order,
      stepTitle: step.title,
      nickname: this.nick(p.hunterId),
      at: p.at,
      verdict: p.verdict,
      reason: p.reason,
      insisted: p.insisted,
      review: p.counted ? (p.review ?? 'pending') : null,
      hasReference: this.refPhotos.has(p.stepId),
      purged: false,
    };
  }

  private blob(fn: () => string | null): Observable<Blob> {
    return defer(() => {
      const url = fn();
      return url ? fetch(url).then((r) => r.blob()) : Promise.reject(new ApiError('Photo introuvable.'));
    }).pipe(delay(LATENCY_MS));
  }

  /* ---------- Outils internes ---------- */

  private reply<T>(fn: () => T): Observable<T> {
    return defer(() => {
      try {
        return of(structuredClone(fn()));
      } catch (e) {
        return throwError(() => e);
      }
    }).pipe(delay(LATENCY_MS));
  }

  /** Déclenchement : horodatage réel et heure de départ de chaque équipe (§ 5.1). */
  private start(h: MockDb['hunts'][number]): void {
    const now = new Date().toISOString();
    h.status = 'running';
    h.started = now;
    const teams = this.db.teams.filter((t) => t.huntId === h.id);
    const starts = teamStartTimes(h, teams, now);
    teams.forEach((t) => (t.started = starts.get(t.id) ?? null));
  }

  /** Chasse surprise : quand toutes les équipes sont arrivées, elle se clôt et le podium s'affiche. */
  private closeSurpriseIfAllArrived(h: MockDb['hunts'][number]): void {
    if (!h.surprise || this.db.teams.some((t) => t.huntId === h.id && !t.finished && !t.abandoned)) return;
    h.status = 'closed';
    h.closed = new Date().toISOString();
  }

  private viewer(): number | null {
    return this.session.user()?.id ?? null;
  }

  private requireUser(): number {
    const me = this.viewer();
    if (me === null) throw new ApiError('Connectez-vous pour continuer.');
    return me;
  }

  private visibleHunt(id: number) {
    const h = this.db.hunts.find((x) => x.id === id);
    if (!h || (h.status === 'draft' && h.ownerId !== this.viewer())) throw new ApiError('Secret Track introuvable.');
    return h;
  }

  private ownedHunt(id: number) {
    const h = this.visibleHunt(id);
    if (h.ownerId !== this.requireUser()) throw new ApiError('Réservé à l’organisateur de la Secret Track.');
    return h;
  }

  private joinableHunt(huntId: number, me: number) {
    const h = this.visibleHunt(huntId);
    if (h.status !== 'published' && !openToLateTeams(h)) throw new ApiError('Les inscriptions sont fermées.');
    if (h.ownerId === me) throw new ApiError('Vous organisez cette Secret Track.');
    if (this.teamOf(huntId, me)) throw new ApiError('Vous êtes déjà inscrit à cette Secret Track.');
    return h;
  }

  private huntView(h: MockDb['hunts'][number]): Hunt {
    return {
      ...h,
      ownerNickname: this.nick(h.ownerId),
      hostNickname: h.hostId === null ? null : this.nick(h.hostId),
      stepCount: finalOrder(this.stepsOf(h.id)),
      teamCount: this.db.teams.filter((t) => t.huntId === h.id).length,
      cover: this.coverStep(h.id) !== null,
    };
  }

  /** Étape de départ avec photo : la couverture de la chasse (§ 49). */
  private coverStep(huntId: number): number | null {
    const start = this.db.steps.find((s) => s.huntId === huntId && s.order === 0);
    return start && this.refPhotos.has(start.id) ? start.id : null;
  }

  huntCover(huntId: number): Observable<Blob> {
    return this.blob(() => {
      const id = this.coverStep(huntId);
      return id === null ? null : (this.refPhotos.get(id) ?? null);
    });
  }

  /** La maquette reprend la photo du départ de la chasse publiée. */
  catalogCover(entryId: number): Observable<Blob> {
    return this.blob(() => {
      const e = this.catalog.find((x) => x.id === entryId);
      const id = e?.huntId ? this.coverStep(e.huntId) : null;
      return id === null ? null : (this.refPhotos.get(id) ?? null);
    });
  }

  private stepsOf(huntId: number): Step[] {
    return this.db.steps.filter((s) => s.huntId === huntId).sort((a, b) => a.order - b.order);
  }

  private teamOf(huntId: number, hunterId: number | null): Team | null {
    if (hunterId === null) return null;
    return this.db.teams.find((t) => t.huntId === huntId && t.members.some((m) => m.hunterId === hunterId)) ?? null;
  }

  private addTeam(h: MockDb['hunts'][number], name: string, owner: number, solo: boolean): Team {
    const team: Team = {
      id: this.nextId(this.db.teams),
      huntId: h.id,
      name,
      ownerId: owner,
      joinCode: randomToken(6).toUpperCase(),
      solo,
      startOrder: null,
      started: null,
      finished: null,
      abandoned: null,
      members: [{ hunterId: owner, nickname: this.nick(owner) }],
    };
    this.db.teams.push(team);
    return team;
  }

  private playState(huntId: number): PlayState {
    const me = this.requireUser();
    const hunt = this.huntView(this.visibleHunt(huntId));
    const team = this.teamOf(huntId, me);
    if (!team) throw new ApiError('Vous n’êtes pas inscrit à cette Secret Track.');
    const steps = this.stepsOf(huntId);
    const vals = this.db.validations.filter((v) => v.teamId === team.id);
    const validated = vals
      .map((v) => {
        const s = steps.find((x) => x.id === v.stepId)!;
        const photo = this.photos.find((p) => p.teamId === team.id && p.stepId === s.id && p.counted);
        return {
          order: s.order,
          title: s.title,
          arrival: s.arrival,
          at: v.at,
          skipped: v.source === 'SKIP',
          photo: photo ? ((photo.review ?? 'pending') as PhotoReview) : null,
          illustration: this.illustration(s, 'arrival'),
              credit: this.illustrationCredit(s, 'arrival'),
        };
      })
      .sort((a, b) => a.order - b.order);
    const hints = this.db.hintUses.filter((u) => u.teamId === team.id);

    let clue: PlayClue | null = null;
    const started = team.started !== null && Date.parse(team.started) <= Date.now();
    if (hunt.status === 'running' && started && !team.finished && !team.abandoned) {
      const current = steps.find((s) => s.order === lastValidatedOrder(steps, vals))!;
      const revealed = hints.filter((u) => u.stepId === current.id).sort((a, b) => a.level - b.level);
      clue = {
        stepId: current.id,
        targetOrder: current.order + 1,
        instructions: current.instructions ?? '',
        hintsRevealed: revealed.map((u) => current.hints[u.level - 1]),
        hintsTotal: current.hints.length,
        canSkip: true,
        illustration: this.illustration(steps.find((s) => s.order === current.order + 1), 'clue'),
              credit: this.illustrationCredit(steps.find((s) => s.order === current.order + 1), 'clue'),
      };
    }
    let puzzle: PlayState['puzzle'] = null;
    const target = clue ? steps.find((s) => s.order === clue!.targetOrder) : undefined;
    const arrival = target?.puzzle ? this.arrivals.get(`${team.id}:${target.id}`) : undefined;
    if (target?.puzzle && arrival) {
      const view = publicPuzzle(target.puzzle, target.id);
      puzzle = {
        stepId: target.id,
        order: target.order,
        title: target.title,
        puzzle: { ...view, hint: arrival.hint ? view.hint : null },
        hasHint: !!view.hint,
        attempts: arrival.attempts,
        hintShown: arrival.hint,
      };
    }
    const position = hunt.status === 'running' && team.started && hunt.tools.includes('live') ? teamPosition(this.ranking(huntId), team.id) : null;
    return {
      hunt,
      team,
      totalSteps: finalOrder(steps),
      validated,
      clue,
      hintsUsed: hints.length,
      skipsUsed: vals.filter((v) => v.source === 'SKIP').length,
      penalty: penaltyMinutes(hunt, hints, vals),
      position,
      selfStart: canSelfStart(hunt, team, me),
      photoProof: hunt.validation === 'qr',
      puzzle,
      trail: hunt.tools.includes('map')
        ? validated
            .filter((v) => !v.skipped)
            .map((v) => steps.find((x) => x.order === v.order)!)
            .filter((x) => x.latitude !== null && x.longitude !== null)
            .map((x) => ({ order: x.order, title: x.title, lat: x.latitude!, lng: x.longitude! }))
        : null,
      start: (() => {
        const s = steps.find((x) => x.order === 0);
        return s && s.latitude !== null && s.longitude !== null ? { name: s.address?.trim() || null, lat: s.latitude, lng: s.longitude } : null;
      })(),
    };
  }

  private ranking(huntId: number): RankingRow[] {
    const h = this.db.hunts.find((x) => x.id === huntId)!;
    const teams = this.db.teams.filter((t) => t.huntId === huntId);
    const ids = new Set(teams.map((t) => t.id));
    return computeRanking(
      h,
      teams,
      this.db.validations.filter((v) => ids.has(v.teamId)),
      this.db.hintUses.filter((u) => ids.has(u.teamId)),
    );
  }

  private liveRows(huntId: number): LiveRow[] {
    const steps = this.stepsOf(huntId);
    const now = Date.now();
    return this.db.teams
      .filter((t) => t.huntId === huntId)
      .map((team) => {
        const vals = this.db.validations.filter((v) => v.teamId === team.id);
        const status: LiveRow['status'] = team.finished
          ? 'finished'
          : team.abandoned
            ? 'abandoned'
            : team.started && Date.parse(team.started) <= now
              ? 'running'
              : 'waiting';
        return {
          team,
          lastOrder: lastValidatedOrder(steps, vals),
          lastAt: vals.map((v) => v.at).sort().at(-1) ?? null,
          hints: this.db.hintUses.filter((u) => u.teamId === team.id).length,
          skips: vals.filter((v) => v.source === 'SKIP').length,
          status,
          photosToReview: this.photos.filter((p) => p.teamId === team.id && p.counted && !p.review).length,
        };
      })
      .sort((a, b) => (a.team.startOrder ?? 999) - (b.team.startOrder ?? 999) || a.team.id - b.team.id);
  }

  private blankStep(huntId: number, order: number, title: string): Step {
    return {
      id: this.nextId(this.db.steps),
      huntId,
      order,
      token: order === 0 ? null : randomToken(),
      title,
      arrival: null,
      instructions: null,
      hints: [],
      answer: null,
      latitude: null,
      longitude: null,
      address: null,
      referencePhoto: false,
      photoShow: null,
      photoCredit: null,
      entrances: [],
      puzzle: null,
    };
  }

  private nick(id: number): string {
    return this.db.hunters.find((h) => h.id === id)?.nickname ?? '?';
  }

  private publicHunter(h: Hunter): Hunter {
    return { id: h.id, nickname: h.nickname, email: h.email, rateable: h.rateable, reviewer: this.isReviewer(h.id) };
  }

  private nextId(list: { id: number }[]): number {
    return list.reduce((max, x) => Math.max(max, x.id), 0) + 1;
  }
}

const REVIEWER_ID = 1;
/** Membre fondateur de la maquette : Seb. */
const FOUNDER_ID = 1;

/** Chasse surprise « chacun son chrono » en cours : on peut encore s'y inscrire et partir. */
function openToLateTeams(h: Pick<Hunt, 'surprise' | 'selfPaced' | 'status'>): boolean {
  return h.surprise && h.selfPaced && h.status === 'running';
}

/** Le joueur peut-il donner un départ (celui de son équipe, ou celui de tous) ? */
function canSelfStart(h: Pick<Hunt, 'surprise' | 'selfPaced' | 'status' | 'hostId'>, team: Team, me: number): boolean {
  if (!h.surprise) return false;
  if (h.selfPaced) return !team.started && (h.status === 'published' || h.status === 'running');
  return h.status === 'published' && h.hostId === me;
}

interface MockPhoto {
  id: number;
  teamId: number;
  stepId: number;
  hunterId: number;
  image: string;
  at: string;
  verdict: 'match' | 'nomatch';
  reason: string;
  insisted: boolean;
  /** A validé l'étape (avis favorable ou insistance). */
  counted: boolean;
  review: Exclude<PhotoReview, 'pending'> | null;
}

interface MockEntry {
  id: number;
  /** Repères pratiques (§ 26). */
  practical: PracticalTag[];
  minAge: number | null;
  audience: AudienceTag[];
  setting: Setting | null;
  /** Prix fixé par l'auteur (§ 20), en centimes. */
  price: number;
  authorId: number;
  huntId: number | null;
  parentId: number | null;
  title: string;
  summary: string;
  location: string;
  travel: CatalogPublication['travel'];
  difficulty: CatalogPublication['difficulty'];
  durationMinutes: number;
  stepCount: number;
  validation: Hunt['validation'];
  sampleOrder: number;
  sample: string;
  changes: string | null;
  content: {
    hunt: Pick<
      Hunt,
      | 'name'
      | 'description'
      | 'location'
      | 'award'
      | 'startText'
      | 'startMode'
      | 'interval'
      | 'hintPenalties'
      | 'skipPenalty'
      | 'teamGame'
      | 'teamMin'
      | 'teamMax'
      | 'validation'
      | 'geoRadius'
      | 'contribution'
    > &
      Partial<Pick<Hunt, 'skin' | 'tools'>>;
    steps: Pick<Step, 'order' | 'title' | 'arrival' | 'instructions' | 'hints' | 'latitude' | 'longitude' | 'address'>[];
  };
  fingerprint: string;
  published: string;
  withdrawn: boolean;
}

const average = (values: number[]): number | null =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

/** Liste de Secret Tracks (§ 38). */
interface MockList {
  id: number;
  ownerId: number;
  name: string;
  icon: string;
  favorite: boolean;
  code: string | null;
  members: number[];
  items: number[];
}
