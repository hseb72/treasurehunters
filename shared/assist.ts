/**
 * Assistant de rédaction (docs/conception.md § 25) : l'IA propose, dans l'éditeur, une
 * énigme reformulée, plus facile ou plus difficile, trois jokers progressifs, ou une relecture.
 * Chaque proposition réussie compte une suggestion, sur 30 jours glissants : l'organisateur
 * voit à tout moment ce qu'il a consommé et ce qu'il lui reste.
 */

export type AssistAction = 'rephrase' | 'easier' | 'harder' | 'hints' | 'review' | 'diagnose';

export const ASSIST_ACTIONS: { id: AssistAction; label: string; short: [string, string]; icon: string; description: string }[] = [
  { id: 'rephrase', label: 'Reformuler', short: ['reformulation', 'reformulations'], icon: 'edit_note', description: 'Même difficulté, en plus clair et plus vivant.' },
  { id: 'easier', label: 'Plus facile', short: ['simplification', 'simplifications'], icon: 'trending_down', description: 'Pour des enfants ou des débutants.' },
  { id: 'harder', label: 'Plus difficile', short: ['durcissement', 'durcissements'], icon: 'trending_up', description: 'Pour des joueurs aguerris.' },
  { id: 'hints', label: 'Proposer 3 jokers', short: ['jeu de jokers', 'jeux de jokers'], icon: 'key', description: 'Du plus discret au plus direct.' },
  { id: 'review', label: 'Relire', short: ['relecture', 'relectures'], icon: 'spellcheck', description: 'Repère une énigme ambiguë, trop vague ou qui mène ailleurs.' },
  {
    id: 'diagnose',
    label: 'Analyser les difficultés',
    short: ['analyse', 'analyses'],
    icon: 'troubleshoot',
    description: 'D’après les données des joueurs, explique pourquoi ils bloquent et propose une énigme corrigée.',
  },
];

/** Actions proposées dans l'éditeur ; l'analyse part des statistiques (§ 43). */
export const EDITOR_ACTIONS = ASSIST_ACTIONS.filter((a) => a.id !== 'diagnose');

export function assistAction(id: AssistAction) {
  return ASSIST_ACTIONS.find((a) => a.id === id)!;
}

/** Limites, pour tous (conditions d'utilisation, § 25). */
export const ASSIST_LIMITS = {
  /** Suggestions par 30 jours glissants, pour tous. */
  monthly: 30,
  /** … avec un forfait de génération en cours, ou pour les membres fondateurs. */
  passMonthly: 200,
  /** Suggestions par 24 heures glissantes, pour tous (protège le service des abus). */
  daily: 40,
  /** Durée de la fenêtre glissante, en jours. */
  windowDays: 30,
};

export type AssistPlan = 'base' | 'pass' | 'founder';

/** Décompte des suggestions d'un organisateur : ce qu'il a utilisé, ce qu'il lui reste, et quand ça revient. */
export interface AssistUsage {
  plan: AssistPlan;
  /** Suggestions permises sur 30 jours glissants. */
  limit: number;
  used: number;
  remaining: number;
  today: number;
  daily: number;
  /** Date à laquelle la plus ancienne suggestion comptée sort de la fenêtre (une de plus redevient disponible). */
  nextRefill: string | null;
  /** Suggestions des 30 derniers jours, par nature. */
  byAction: Record<AssistAction, number>;
  /** Pourquoi on ne peut pas demander de suggestion maintenant. */
  blocked: string | null;
}

/**
 * Décompte à partir des suggestions des 30 derniers jours (règle commune au serveur et à la
 * maquette). `uses` peut contenir des suggestions plus anciennes : elles sont ignorées.
 */
export function assistUsage(uses: { action: AssistAction; at: string }[], plan: AssistPlan, now = Date.now()): AssistUsage {
  const windowMs = ASSIST_LIMITS.windowDays * 86_400_000;
  const recent = uses.filter((u) => now - Date.parse(u.at) < windowMs).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const today = recent.filter((u) => now - Date.parse(u.at) < 86_400_000).length;
  const limit = plan === 'base' ? ASSIST_LIMITS.monthly : ASSIST_LIMITS.passMonthly;
  const byAction = Object.fromEntries(ASSIST_ACTIONS.map((a) => [a.id, 0])) as Record<AssistAction, number>;
  for (const u of recent) byAction[u.action]++;
  const used = recent.length;
  const remaining = Math.max(0, limit - used);
  const nextRefill = recent.length ? new Date(Date.parse(recent[0]!.at) + windowMs).toISOString() : null;
  let blocked: string | null = null;
  if (remaining === 0) blocked = `Vous avez utilisé vos ${limit} suggestions des 30 derniers jours.`;
  else if (today >= ASSIST_LIMITS.daily) blocked = `Vous avez demandé ${ASSIST_LIMITS.daily} suggestions en 24 heures : revenez demain.`;
  return { plan, limit, used, remaining, today, daily: ASSIST_LIMITS.daily, nextRefill, byAction, blocked };
}

/** Ce que l'organisateur a écrit, envoyé tel quel (même pas encore enregistré). */
export interface AssistRequest {
  action: AssistAction;
  instructions: string;
  hints: string[];
}

/** Proposition de l'IA : jamais appliquée d'office, l'organisateur choisit. */
export interface AssistSuggestion {
  action: AssistAction;
  /** Énigme proposée (reformulée, plus facile, plus difficile, ou corrigée par la relecture). */
  instructions: string | null;
  /** Trois jokers, du plus discret au plus direct. */
  hints: string[] | null;
  /** Relecture : remarques sur l'énigme (ambiguïtés, fautes, lieu mal désigné). */
  review: string | null;
}

export interface AssistReply {
  suggestion: AssistSuggestion;
  usage: AssistUsage;
}
