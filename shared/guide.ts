/**
 * Guide (docs/conception.md § 46) : le joueur dit ce qu'il souhaite (« en famille avec deux
 * enfants, une balade cet après-midi, avec une pause goûter »), le guide le comprend, cherche
 * dans le catalogue, et à défaut invente un parcours sur mesure.
 */
import { CatalogEntry, Difficulty, Travel } from './models.js';
import { AudienceTag } from './practical.js';

/** Temps gardé hors du jeu : goûter, shopping, déjeuner… */
export interface GuideActivity {
  activity: string;
  minutes: number;
}

/**
 * Centre d'intérêt du joueur (« Sneakers ») et les catégories OpenStreetMap qui y répondent :
 * il apparaît en tête du volet « Autour de moi » (§ 45) pendant la partie.
 */
export interface GuideInterest {
  label: string;
  filters: { key: string; values: string[] | null }[];
}

export interface GuideRequest {
  /** Ce que le joueur a dit (ou écrit), transcrit par le téléphone. */
  text: string;
  /** Position du téléphone, si le joueur l'a donnée. */
  position: { lat: number; lng: number } | null;
}

/** Ce que le guide a compris de la demande. */
export interface GuideUnderstanding {
  /** Lieu nommé par le joueur (« Montpellier ») ; null = autour de sa position. */
  place: string | null;
  /** Temps disponible en tout, en minutes. */
  totalMinutes: number;
  /** Temps réservé hors du jeu, retiré de la durée du parcours. */
  reserved: GuideActivity[];
  /** Durée du parcours : le temps disponible moins le temps réservé. */
  playMinutes: number;
  travel: Travel;
  difficulty: Difficulty;
  audience: AudienceTag | null;
  /** Âge du plus jeune joueur, s'il a été dit. */
  youngestAge: number | null;
  /** Thème du parcours (« street art »), suivi s'il est réalisable. */
  theme: string | null;
  interests: GuideInterest[];
  /** Question à poser quand il manque l'essentiel (le lieu, sans position) ; null sinon. */
  question: string | null;
  /** Récapitulatif dit au joueur : « Je vous prévois 1 h 30 de balade… ». */
  summary: string;
  /** Décompte des demandes après celle-ci (§ 46) ; absent dans la maquette hors ligne. */
  usage?: GuideUsage;
}

/**
 * Quotas du guide (§ 46) : chaque demande comprise par l'IA compte, sur 30 jours glissants.
 * Sans compte : 4 (comptées par appareil réseau) ; avec un compte : 12 ; avec un forfait de
 * Secret Tracks sur mesure en cours, ou membre fondateur : 100. Au-delà, plafond commun à
 * tous les visiteurs sans compte, par jour, pour borner le coût quoi qu'il arrive.
 */
export type GuidePlan = 'visitor' | 'base' | 'pass' | 'founder';

export const GUIDE_LIMITS: Record<GuidePlan, number> & { windowDays: number; visitorsDaily: number } = {
  visitor: 4,
  base: 12,
  pass: 100,
  founder: 100,
  windowDays: 30,
  visitorsDaily: 200,
};

export interface GuideUsage {
  plan: GuidePlan;
  limit: number;
  used: number;
  remaining: number;
  /** Quand la plus ancienne demande comptée redevient disponible. */
  nextRefill: string | null;
  /** Pourquoi le guide ne peut pas répondre maintenant ; null sinon. */
  blocked: string | null;
}

/** Décompte d'après les demandes des 30 derniers jours (règle commune au serveur et à la maquette). */
export function guideUsage(uses: string[], plan: GuidePlan, now = Date.now(), visitorsToday = 0): GuideUsage {
  const windowMs = GUIDE_LIMITS.windowDays * 86_400_000;
  const recent = uses.filter((at) => now - Date.parse(at) < windowMs).sort();
  const limit = GUIDE_LIMITS[plan];
  const used = recent.length;
  const remaining = Math.max(0, limit - used);
  const nextRefill = recent.length ? new Date(Date.parse(recent[0]!) + windowMs).toISOString() : null;
  let blocked: string | null = null;
  if (remaining === 0) {
    blocked =
      plan === 'visitor'
        ? `Vous avez utilisé vos ${limit} demandes gratuites de ce mois-ci. Créez un compte (gratuit) pour en avoir ${GUIDE_LIMITS.base} par mois.`
        : plan === 'base'
          ? `Vous avez utilisé vos ${limit} demandes de ce mois-ci. Un forfait de Secret Tracks sur mesure en donne ${GUIDE_LIMITS.pass}.`
          : `Vous avez utilisé vos ${limit} demandes de ce mois-ci.`;
  } else if (plan === 'visitor' && visitorsToday >= GUIDE_LIMITS.visitorsDaily) {
    blocked = 'Le guide est très demandé aujourd’hui : connectez-vous pour l’utiliser, ou revenez demain.';
  }
  return { plan, limit, used, remaining, nextRefill, blocked };
}

/** Durée par défaut quand le joueur n'en dit rien, et durée minimale d'un parcours. */
export const GUIDE_DEFAULT_MINUTES = 90;
export const GUIDE_MIN_PLAY_MINUTES = 30;
export const GUIDE_MAX_MINUTES = 8 * 60;
/** Au plus trois centres d'intérêt. */
export const GUIDE_MAX_INTERESTS = 3;

/** Durée du parcours une fois le temps réservé retiré, jamais sous le minimum. */
export function playMinutesOf(totalMinutes: number, reserved: GuideActivity[]): number {
  const kept = reserved.reduce((sum, r) => sum + Math.max(0, r.minutes), 0);
  return Math.max(GUIDE_MIN_PLAY_MINUTES, Math.round((totalMinutes - kept) / 5) * 5);
}

/** Distance maximale entre le joueur et le départ d'une Secret Track proposée, en km. */
export const GUIDE_CATALOG_RADIUS: Record<Travel, number> = { walk: 3, active: 10, motor: 40 };

/** Durées acceptées autour de la durée voulue : un peu plus court, guère plus long. */
export function guideDurationWindow(playMinutes: number): { min: number; max: number } {
  return { min: Math.round(playMinutes * 0.6), max: playMinutes + 20 };
}

/**
 * Les Secret Tracks du catalogue les mieux assorties à la demande, au plus `n` : déjà filtrées
 * par lieu, déplacement et durée, on préfère la bonne difficulté, le bon public, un âge
 * minimum compatible, la proximité et les bonnes notes.
 */
export function rankProposals(entries: CatalogEntry[], u: GuideUnderstanding, n = 3): CatalogEntry[] {
  const score = (e: CatalogEntry) => {
    let s = 0;
    if (e.difficulty === u.difficulty) s += 3;
    if (u.audience && e.audience.includes(u.audience)) s += 2;
    if (u.youngestAge !== null && e.minAge !== null && e.minAge > u.youngestAge) s -= 6;
    s -= Math.abs(e.durationMinutes - u.playMinutes) / 15;
    s -= (e.distanceKm ?? 0) / 2;
    s += (e.rating.stars ?? 0) / 2;
    return s;
  };
  return entries
    .filter((e) => !e.withdrawn)
    .map((e) => ({ e, s: score(e) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(({ e }) => e);
}

/**
 * Avant un parcours sur mesure (§ 46) : les Secret Tracks du catalogue qui répondent déjà à la
 * demande, déjà filtrées par lieu, déplacement et durée, classées comme celles du guide.
 */
export function rankForGeneration(entries: CatalogEntry[], r: { durationMinutes: number; difficulty: Difficulty }, n = 3): CatalogEntry[] {
  return rankProposals(entries, { difficulty: r.difficulty, audience: null, youngestAge: null, playMinutes: r.durationMinutes } as GuideUnderstanding, n);
}

/** « 1 h 30 », « 45 min » : pour les phrases dites par le guide. */
export function spokenMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} heure${h > 1 ? 's' : ''}${m ? ` ${m}` : ''}`;
}

const TRAVEL_SPOKEN: Record<Travel, string> = { walk: 'balade à pied', active: 'parcours à vélo ou d’un bon pas', motor: 'expédition en véhicule' };

/** Récapitulatif dit au joueur, construit d'après ce qui a été compris (jamais inventé par l'IA). */
export function guideSummary(u: Omit<GuideUnderstanding, 'summary' | 'question'>): string {
  const where = u.place ? ` à ${u.place}` : ' autour de vous';
  const reserved = u.reserved.length
    ? ` Il vous restera ${spokenMinutes(u.reserved.reduce((s, r) => s + r.minutes, 0))} pour ${u.reserved.map((r) => r.activity).join(' et ')}.`
    : '';
  const interests = u.interests.length ? ` Pendant la partie, le bouton « Autour » vous montrera : ${u.interests.map((i) => i.label).join(', ')}.` : '';
  return `Je vous prévois ${spokenMinutes(u.playMinutes)} de ${TRAVEL_SPOKEN[u.travel]}${where}.${reserved}${interests}`;
}

/** Question quand le lieu manque : ni lieu nommé, ni position du téléphone. */
export const GUIDE_WHERE_QUESTION = 'Où souhaitez-vous jouer ? Dites-moi une ville ou un quartier, ou autorisez votre position.';

/**
 * Compréhension sans IA, par mots-clés : pour la maquette, les tests et quand l'IA ne répond
 * pas. Moins fine que l'IA, mais suffisante pour les demandes simples.
 */
export function demoUnderstanding(req: GuideRequest): GuideUnderstanding {
  const t = req.text.toLowerCase();
  const kids = /enfant|famille|petits?\b|fils|fille/.test(t);
  const travel: Travel = /voiture|moto|véhicule|vehicule/.test(t) ? 'motor' : /vélo|velo|trottinette|course|sportif/.test(t) ? 'active' : 'walk';
  const difficulty: Difficulty = kids || /facile|tranquille/.test(t) ? 'easy' : /difficile|corsé|expert|costaud/.test(t) ? 'hard' : 'medium';
  const hours = /(\d+)\s*h(?:eures?)?\s*(\d{1,2})?/.exec(t);
  const totalMinutes = hours
    ? Number(hours[1]) * 60 + Number(hours[2] ?? 0)
    : /après-midi|apres-midi|aprèm/.test(t)
      ? 180
      : /matin/.test(t)
        ? 150
        : /journée/.test(t)
          ? 360
          : GUIDE_DEFAULT_MINUTES;
  const reserved: GuideActivity[] = [];
  if (/goûter|gouter/.test(t)) reserved.push({ activity: 'le goûter', minutes: 30 });
  if (/déjeuner|dejeuner|déjeuner|resto/.test(t)) reserved.push({ activity: 'le déjeuner', minutes: 60 });
  if (/shopping|boutiques?|sneakers|chaussures/.test(t)) reserved.push({ activity: 'le shopping', minutes: 45 });
  const interests: GuideInterest[] = [];
  if (/sneakers|baskets|chaussures/.test(t)) interests.push({ label: 'Sneakers', filters: [{ key: 'shop', values: ['shoes', 'sports'] }] });
  if (/glace/.test(t)) interests.push({ label: 'Glaces', filters: [{ key: 'amenity', values: ['ice_cream'] }] });
  const placeMatch = /\b(?:à|a|dans|sur|visiter)\s+([A-ZÉÈ][\p{L}'-]+(?:[ -][A-ZÉÈ][\p{L}'-]+)*)/u.exec(req.text);
  const place = placeMatch?.[1] ?? null;
  const base = {
    place,
    totalMinutes: Math.min(GUIDE_MAX_MINUTES, totalMinutes),
    reserved,
    playMinutes: playMinutesOf(Math.min(GUIDE_MAX_MINUTES, totalMinutes), reserved),
    travel,
    difficulty,
    audience: kids ? ('family' as const) : null,
    youngestAge: null,
    theme: null,
    interests,
  };
  return { ...base, question: !place && !req.position ? GUIDE_WHERE_QUESTION : null, summary: guideSummary(base) };
}
