/**
 * Écriture de la chasse par Claude (§ 11.2) : à partir de lieux réels fournis par
 * OpenStreetMap, Claude choisit un parcours et invente les énigmes et les jokers.
 * Les coordonnées viennent toujours d'OpenStreetMap, jamais du modèle.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { HuntPlan, PlannedStep } from '../../../shared/generation.js';
import { Difficulty } from '../../../shared/models.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { Poi } from './osm.js';

const PlanSchema = z.object({
  name: z.string().describe('Nom de la chasse, 50 caractères maximum'),
  description: z.string().describe('Accroche de la chasse, 2 à 3 phrases, sans dévoiler les lieux'),
  startText: z.string().describe('Texte d’ambiance lu au départ, avant la première énigme'),
  award: z.string().describe('Récompense symbolique annoncée au vainqueur'),
  places: z
    .array(
      z.object({
        poiId: z.string().describe('Identifiant exact du lieu, tel que fourni dans la liste'),
        title: z.string().describe('Titre de l’étape, affiché une fois le lieu trouvé'),
        riddle: z.string().describe('Énigme qui mène À ce lieu depuis le lieu précédent (ou depuis le départ)'),
        hints: z.array(z.string()).describe('Exactement 3 jokers pour trouver ce lieu, du plus vague au plus précis'),
        arrival: z.string().describe('Message d’arrivée sur ce lieu : bravo et anecdote vraie et prudente sur le lieu'),
      }),
    )
    .describe('Lieux dans l’ordre du parcours ; le dernier cache le trésor'),
});

type Plan = z.infer<typeof PlanSchema>;

const DIFFICULTY_BRIEF: Record<Difficulty, string> = {
  easy: 'Facile, pour une famille avec enfants : énigmes directes, vocabulaire simple, un lieu se devine en le cherchant du regard.',
  medium: 'Intermédiaire : énigmes imagées, jeux de mots, qui demandent un peu de réflexion.',
  hard: 'Difficile, pour joueurs aguerris : énigmes cryptiques, charades, allusions historiques ; les jokers restent justes.',
};

const SYSTEM = `Tu es le maître du jeu de Treasure Hunters, une application française de chasses au trésor et de jeux de piste dans la veine des films d'aventure (carnet d'explorateur, boussole, trésor).
Tu inventes une chasse surprise dans un vrai lieu à partir d'une liste de lieux réels issus d'OpenStreetMap.

Règles :
- N'utilise QUE des lieux de la liste, désignés par leur identifiant exact, chacun une seule fois.
- Choisis un parcours faisable à pied : chaque lieu est proche du précédent, sans aller-retour ; le premier est proche du point de départ.
- Il n'y a pas de QR code : le joueur valide une étape en se tenant sur place. Chaque énigme doit donc désigner sans ambiguïté un lieu précis, reconnaissable sur le terrain.
- Chaque énigme mène au lieu suivant et donne une idée de la direction ou de la distance quand c'est utile.
- Ne dévoile jamais le nom du lieu dans son énigme ni dans les deux premiers jokers ; le troisième joker peut presque le nommer.
- N'invente pas de faits : les anecdotes restent prudentes et vraies ou présentées comme une légende.
- Le dernier lieu cache le trésor : son message d'arrivée conclut l'aventure.
- Tout est rédigé en français, tutoiement exclu (vouvoiement), ton d'aventure bienveillant.`;

export interface ClaudePlanInput {
  placeName: string;
  center: { lat: number; lng: number };
  pois: Poi[];
  count: number;
  difficulty: Difficulty;
  durationMinutes: number;
}

export class ClaudePlanner {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    const workspace = config.anthropicWorkspaceId;
    this.client = new Anthropic({ apiKey, defaultHeaders: workspace ? { 'anthropic-workspace-id': workspace } : undefined });
  }

  /** Vérification au démarrage : la clé est acceptée et le modèle configuré existe. */
  async check(): Promise<void> {
    try {
      await this.client.models.retrieve(config.generatorModel);
    } catch (e) {
      throw apiFailure(e);
    }
  }

  async plan(input: ClaudePlanInput): Promise<HuntPlan> {
    const places = input.pois.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      lat: Number(p.lat.toFixed(5)),
      lng: Number(p.lng.toFixed(5)),
      ...p.details,
    }));
    const prompt = `Point de départ : ${input.placeName} (${input.center.lat.toFixed(5)}, ${input.center.lng.toFixed(5)}).
Durée visée : environ ${input.durationMinutes} minutes.
Nombre de lieux à trouver : exactement ${input.count} (le dernier cache le trésor).
Difficulté : ${DIFFICULTY_BRIEF[input.difficulty]}

Lieux disponibles (JSON) :
${JSON.stringify(places)}`;

    let message;
    try {
      // Flux + finalMessage : la réponse est longue et la réflexion peut prendre du temps.
      const stream = this.client.beta.messages.stream({
        model: config.generatorModel,
        max_tokens: 64_000,
        thinking: { type: 'adaptive' },
        output_config: { effort: config.generatorEffort, format: betaZodOutputFormat(PlanSchema) },
        // En cas de refus par les classifieurs, l'API relance la requête sur le modèle de repli recommandé.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      });
      message = await stream.finalMessage();
    } catch (e) {
      throw apiFailure(e);
    }
    if (message.stop_reason === 'refusal') {
      throw new HttpError(422, 'Le générateur n’a pas pu inventer de chasse pour ce lieu. Essayez un autre endroit.', new Error(`refus : ${JSON.stringify(message.stop_details ?? null)}`));
    }
    if (message.stop_reason === 'max_tokens' || !message.parsed_output) {
      throw new HttpError(502, 'Le générateur a rendu une chasse incomplète, réessayez.', new Error(`stop_reason=${message.stop_reason}, sortie analysée : ${!!message.parsed_output}`));
    }
    return toHuntPlan(message.parsed_output, input);
  }
}

/**
 * Erreur de l'API Anthropic → message pour le joueur. Les erreurs de configuration (clé refusée,
 * modèle inconnu, crédit épuisé) ne passeront pas en réessayant : on le dit, au lieu de « ne répond pas ».
 */
export function apiFailure(e: unknown): unknown {
  if (!(e instanceof Anthropic.APIError)) return e;
  // Le statut, le corps de l'erreur et l'identifiant de requête, pour le support Anthropic.
  const cause = new Error(`API Anthropic : ${e.message}${e.requestID ? ` (request_id ${e.requestID})` : ''}`, { cause: e.cause });
  const admin = 'prévenez l’administrateur.';
  if (e instanceof Anthropic.APIConnectionError) return new HttpError(502, 'Le générateur d’énigmes ne répond pas, réessayez dans un instant.', cause);
  if (e instanceof Anthropic.RateLimitError) return new HttpError(503, 'Le générateur est très sollicité, réessayez dans quelques minutes.', cause);
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(503, `Le générateur d’énigmes refuse la clé d’API configurée : ${admin}`, cause);
  }
  if (e instanceof Anthropic.NotFoundError) return new HttpError(503, `Le modèle du générateur d’énigmes est introuvable : ${admin}`, cause);
  if (e instanceof Anthropic.BadRequestError) return new HttpError(503, `Le générateur d’énigmes a rejeté la demande (crédit, modèle ou paramètres) : ${admin}`, cause);
  if (e instanceof Anthropic.InternalServerError) return new HttpError(503, 'Le générateur d’énigmes est surchargé, réessayez dans quelques minutes.', cause);
  return new HttpError(502, 'Le générateur d’énigmes ne répond pas, réessayez dans un instant.', cause);
}

/** Contrôle la réponse du modèle et y rattache les coordonnées réelles des lieux. */
export function toHuntPlan(plan: Plan, input: ClaudePlanInput): HuntPlan {
  const byId = new Map(input.pois.map((p) => [p.id, p]));
  const used = new Set<string>();
  const places = plan.places.filter((p) => {
    if (!byId.has(p.poiId) || used.has(p.poiId)) return false;
    used.add(p.poiId);
    return true;
  });
  if (places.length < Math.min(3, input.count)) throw new HttpError(502, 'Le générateur a rendu une chasse incomplète, réessayez.');
  const kept = places.slice(0, input.count);
  const hints = (h: string[]) => h.map((x) => x.trim()).filter(Boolean).slice(0, 3);

  const steps: PlannedStep[] = [
    {
      title: 'Départ',
      arrival: null,
      instructions: kept[0].riddle,
      hints: hints(kept[0].hints),
      latitude: input.center.lat,
      longitude: input.center.lng,
      address: null,
    },
    ...kept.map((p, i): PlannedStep => {
      const poi = byId.get(p.poiId)!;
      const next = kept[i + 1];
      return {
        title: p.title.slice(0, 255),
        arrival: p.arrival,
        // L'énigme d'une étape mène à la suivante (§ 4.1).
        instructions: next ? next.riddle : null,
        hints: next ? hints(next.hints) : [],
        latitude: poi.lat,
        longitude: poi.lng,
        address: poi.name.slice(0, 255),
      };
    }),
  ];
  return {
    name: plan.name.slice(0, 50),
    description: plan.description.slice(0, 5000),
    startText: plan.startText.slice(0, 5000),
    award: plan.award.slice(0, 2000) || null,
    steps,
  };
}
