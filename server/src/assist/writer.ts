/**
 * Assistant de rédaction (§ 25) : Claude propose une énigme reformulée, plus facile ou plus
 * difficile, trois jokers progressifs, ou une relecture. Il connaît le lieu à faire trouver
 * (que les joueurs ignorent) pour que l'énigme y mène bien, sans jamais le nommer.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { AssistAction, AssistSuggestion } from '../../../shared/assist.js';
import { config } from '../config.js';

export interface AssistCase {
  action: AssistAction;
  hunt: { name: string; location: string; difficulty: string | null; travel: string };
  /** Lieu où se trouvent les joueurs quand ils lisent l'énigme. */
  from: { title: string; address: string | null } | null;
  /** Lieu à faire trouver : la solution de l'énigme. */
  target: { title: string; address: string | null; arrival: string | null };
  instructions: string;
  hints: string[];
  /** Analyse (§ 43) : ce que montrent les données des joueurs et leurs signalements. */
  evidence?: string[];
}

export interface RiddleWriter {
  assist(c: AssistCase): Promise<AssistSuggestion>;
}

const SuggestionSchema = z.object({
  instructions: z.string().nullable().describe('Énigme proposée, prête à coller ; null pour « hints », et pour « review » si l’énigme est déjà bonne'),
  hints: z.array(z.string()).nullable().describe('Pour « hints » : exactement trois jokers, du plus discret au plus direct ; null sinon'),
  review: z.string().nullable().describe('Pour « review » et « diagnose » : remarques courtes en puces « - » ; null sinon'),
});

const TASKS: Record<AssistAction, string> = {
  rephrase: 'Reformule l’énigme : même difficulté, même solution, mais plus claire, plus vivante et mieux rythmée. Garde les éléments indispensables pour trouver le lieu.',
  easier: 'Rends l’énigme nettement plus facile (enfants, débutants) : indices plus concrets, vocabulaire simple, sans donner la réponse mot pour mot.',
  harder: 'Rends l’énigme nettement plus difficile (joueurs aguerris) : plus allusive, jeux de mots ou références, mais toujours résoluble sur place et sans ambiguïté.',
  hints: 'Rédige exactement trois jokers progressifs pour cette énigme : le premier oriente discrètement, le deuxième précise, le troisième désigne presque le lieu sans le nommer.',
  diagnose:
    'Les joueurs butent sur cette énigme : les données ci-dessus le montrent. Explique dans review, en deux à quatre puces courtes, la cause la plus probable (terme ambigu, indice invérifiable, lieu difficile à repérer, énigme trop longue, trop de lieux possibles…), en citant le passage en cause. Puis propose dans instructions une énigme corrigée, même solution, même esprit.',
  review:
    'Relis l’énigme comme un joueur qui ne connaît pas la solution. Signale en quelques puces ce qui pose problème : ambiguïté (plusieurs lieux possibles), indice faux ou invérifiable sur place, lieu trop vague, fautes. Si tu corriges, propose l’énigme corrigée dans instructions ; sinon instructions = null et dis que l’énigme est claire.',
};

/** Énigme pas encore écrite : une première proposition, contre la page blanche. */
const DRAFT = 'Écris une première énigme qui mène au lieu à trouver, adaptée à la difficulté de la chasse.';

const SYSTEM = `Tu es l'assistant de rédaction de SecretTracks, une application de chasses au trésor en ville et en nature.
Un organisateur écrit l'énigme qui mène ses joueurs au lieu suivant du parcours. Tu l'aides, en français, en vouvoyant les joueurs si l'énigme s'adresse à eux.

Règles :
- L'énigme doit mener au lieu indiqué, et à lui seul, depuis le lieu où se trouvent les joueurs.
- Ne nomme JAMAIS le lieu à trouver dans l'énigme ni dans les jokers.
- N'invente pas de détail que tu ne peux pas savoir (inscription, couleur, nombre) : appuie-toi sur ce que l'organisateur a écrit et sur des faits notoires.
- Garde la longueur de l'original, à peu près (au plus 600 caractères pour une énigme, 200 par joker).
- Pas de markdown dans l'énigme ni dans les jokers.`;

export class ClaudeRiddleWriter implements RiddleWriter {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    const workspace = config.anthropicWorkspaceId;
    this.client = new Anthropic({ apiKey, defaultHeaders: workspace ? { 'anthropic-workspace-id': workspace } : undefined });
  }

  async assist(c: AssistCase): Promise<AssistSuggestion> {
    const text = [
      `Chasse : ${c.hunt.name} (${c.hunt.location}) — déplacement : ${c.hunt.travel}${c.hunt.difficulty ? `, énigmes : ${c.hunt.difficulty}` : ''}`,
      c.from ? `Les joueurs sont à : ${c.from.title}${c.from.address ? ` (${c.from.address})` : ''}` : null,
      `Lieu à faire trouver (secret) : ${c.target.title}${c.target.address ? ` (${c.target.address})` : ''}`,
      c.target.arrival ? `Message que les joueurs liront en y arrivant : ${c.target.arrival}` : null,
      `Énigme actuelle :\n${c.instructions || '(pas encore écrite)'}`,
      c.hints.length ? `Jokers actuels :\n${c.hints.map((h, i) => `${i + 1}. ${h}`).join('\n')}` : null,
      c.evidence?.length ? `Ce que montrent les joueurs :\n${c.evidence.map((e) => `- ${e}`).join('\n')}` : null,
      `Demande : ${c.action === 'rephrase' && !c.instructions ? DRAFT : TASKS[c.action]}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const message = await this.client.beta.messages
      .stream({
        model: config.generatorModel,
        max_tokens: 16_000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: betaZodOutputFormat(SuggestionSchema) },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: text }],
      })
      .finalMessage();
    const out = message.stop_reason === 'refusal' ? null : message.parsed_output;
    if (!out) throw new Error(`Suggestion illisible (stop_reason=${message.stop_reason})`);
    return {
      action: c.action,
      instructions: c.action === 'hints' ? null : out.instructions?.trim().slice(0, 2000) || null,
      hints: c.action === 'hints' ? (out.hints ?? []).map((h) => h.trim().slice(0, 300)).filter(Boolean).slice(0, 3) : null,
      review: c.action === 'review' || c.action === 'diagnose' ? out.review?.trim().slice(0, 2000) || null : null,
    };
  }
}
