/**
 * Accès à la génération de chasses par l'IA (docs/conception.md § 21) : gratuite tant que le
 * paiement n'est pas activé ; sinon réservée aux fondateurs, aux forfaits et aux crédits
 * (achetés, ou gagnés en partageant des chasses jouées par d'autres). Les limites d'usage
 * s'appliquent à tous : elles protègent le service du coût de l'IA (conditions d'utilisation).
 */

/** Formules en vente : un crédit (une chasse), ou un forfait de 30 ou 365 jours, sans reconduction. */
export interface GenerationOffer {
  id: 'gen:single' | 'gen:month' | 'gen:year';
  name: string;
  description: string;
  /** Prix en centimes. */
  price: number;
  /** Crédits ajoutés (une chasse réussie = un crédit). */
  credits?: number;
  /** Durée du forfait, en jours. */
  days?: number;
  icon: string;
}

export const GENERATION_OFFERS: GenerationOffer[] = [
  { id: 'gen:single', name: 'Une chasse sur mesure', description: 'Une chasse inventée pour vous, où vous voulez.', price: 299, credits: 1, icon: 'auto_awesome' },
  { id: 'gen:month', name: 'Forfait mensuel', description: 'Des chasses sur mesure pendant 30 jours, dans les limites d’usage.', price: 1000, days: 30, icon: 'calendar_month' },
  { id: 'gen:year', name: 'Forfait annuel', description: 'Des chasses sur mesure pendant un an, dans les limites d’usage.', price: 10000, days: 365, icon: 'workspace_premium' },
];

export function generationOffer(id: string): GenerationOffer | undefined {
  return GENERATION_OFFERS.find((o) => o.id === id);
}

/** Limites d'usage, pour tous (conditions d'utilisation, § 21). */
export const GENERATION_LIMITS = {
  /** Chasses réussies par 24 heures glissantes (surchargeable par GENERATION_DAILY_QUOTA). */
  daily: 5,
  /** Essais, échecs compris, par 24 heures : multiple de la limite quotidienne. */
  attemptsFactor: 4,
  /** Chasses réussies par 30 jours glissants avec un forfait. */
  passMonthly: 40,
  /** Crédits offerts par chasse partagée au catalogue et jouée par d'autres… */
  creatorBonusPerHunt: 2,
  /** … dans la limite de ce nombre de crédits gagnés au total. */
  creatorBonusMax: 20,
};

/** Ce qui autorise une génération, dans l'ordre où on le consomme. */
export type GenerationRight = 'free' | 'founder' | 'pass' | 'credit';

/** État de l'accès d'un joueur : ce qu'il a, ce qu'il a consommé, et s'il peut générer maintenant. */
export interface GenerationAccess {
  /** Génération payante (paiement activé) ; sinon gratuite, limites comprises. */
  paid: boolean;
  founder: boolean;
  /** Fin du forfait en cours, ou null. */
  passUntil: string | null;
  credits: {
    purchased: number;
    /** Crédits gagnés en partageant des chasses jouées par d'autres. */
    bonus: number;
    /** Chasses sur mesure réglées par crédit. */
    used: number;
    available: number;
  };
  /** Chasses partagées au catalogue et jouées par d'autres (source du bonus). */
  sharedPlayed: number;
  usage: { today: number; daily: number; passPeriod: number; passMonthly: number };
  /** Ce qui réglera la prochaine chasse, ou null s'il faut d'abord choisir une formule. */
  right: GenerationRight | null;
  /** Pourquoi on ne peut pas générer maintenant (limite atteinte, aucune formule). */
  blocked: string | null;
}

/** Crédits bonus d'un créateur : par chasse partagée jouée par d'autres, plafonnés. */
export function creatorBonus(sharedPlayed: number): number {
  return Math.min(GENERATION_LIMITS.creatorBonusMax, sharedPlayed * GENERATION_LIMITS.creatorBonusPerHunt);
}

/**
 * Choix du droit qui règle la prochaine chasse (règle commune au serveur et à la maquette) :
 * gratuite sans paiement ; sinon fondateur, forfait (dans sa limite mensuelle), crédit.
 */
export function pickRight(a: Omit<GenerationAccess, 'right' | 'blocked'>): { right: GenerationRight | null; blocked: string | null } {
  if (a.usage.today >= a.usage.daily) return { right: null, blocked: `Vous avez déjà inventé ${a.usage.daily} chasses aujourd’hui : revenez demain !` };
  if (!a.paid) return { right: 'free', blocked: null };
  if (a.founder) return { right: 'founder', blocked: null };
  const passActive = !!a.passUntil && Date.parse(a.passUntil) > Date.now();
  if (passActive && a.usage.passPeriod < a.usage.passMonthly) return { right: 'pass', blocked: null };
  if (a.credits.available > 0) return { right: 'credit', blocked: null };
  if (passActive) return { right: null, blocked: `Votre forfait compte déjà ${a.usage.passMonthly} chasses sur 30 jours : un crédit à l’unité permet d’en inventer une de plus.` };
  return { right: null, blocked: null };
}
