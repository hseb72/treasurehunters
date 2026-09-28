/**
 * Traduction des textes des chasses (§ 33) : Claude traduit un lot de textes du français vers
 * l'anglais, en gardant le ton du jeu et les jeux de mots résolubles ; sortie structurée.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { config } from '../config.js';

export interface Translator {
  /** Autant de traductions que de textes, dans le même ordre. */
  translate(texts: string[], lang: 'en'): Promise<string[]>;
}

const OutputSchema = z.object({ translations: z.array(z.string()).describe('Les traductions, dans l’ordre des textes reçus') });

const SYSTEM = `You translate content of Treasure Hunters, a treasure hunt app, from French into natural English for tourists.
Texts are riddles, hints, arrival messages, place names and hunt descriptions.
Rules:
- Keep the playful tone and the meaning needed to solve the riddle; when a French pun cannot be translated, rephrase so the clue still leads to the same place.
- Keep proper nouns of real places as they are locally known (e.g. "Place de la Comédie"), you may add a short English gloss in parentheses when useful.
- Never add information that is not in the source; never reveal answers.
- Return exactly one translation per input text, in the same order.`;

export class ClaudeTranslator implements Translator {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    const workspace = config.anthropicWorkspaceId;
    this.client = new Anthropic({ apiKey, defaultHeaders: workspace ? { 'anthropic-workspace-id': workspace } : undefined });
  }

  async translate(texts: string[], lang: 'en'): Promise<string[]> {
    const message = await this.client.beta.messages
      .stream({
        model: config.generatorModel,
        max_tokens: 16_000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: betaZodOutputFormat(OutputSchema) },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: `Target language: ${lang}\n\nTexts (JSON array):\n${JSON.stringify(texts)}` }],
      })
      .finalMessage();
    const out = message.stop_reason === 'refusal' ? null : message.parsed_output;
    if (!out || out.translations.length !== texts.length) throw new Error(`Traduction illisible (stop_reason=${message.stop_reason})`);
    return out.translations.map((t, i) => t.trim().slice(0, Math.max(200, texts[i]!.length * 3)));
  }
}
