/**
 * Avis de l'IA sur une photo de joueur (§ 12) : montre-t-elle le lieu de l'étape ?
 * Claude compare avec la photo de référence de l'organisateur, s'il y en a une, et
 * avec la description du lieu. Seule une correspondance évidente valide l'étape.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { config } from '../config.js';
import { StoredPhoto } from './store.js';

export interface PhotoCase {
  /** Titre de l'étape, message d'arrivée et adresse : ce que l'organisateur sait du lieu. */
  place: { title: string; arrival: string | null; address: string | null };
  /** Énigme qui mène au lieu. */
  riddle: string | null;
  reference: StoredPhoto | null;
  photo: StoredPhoto;
}

export interface PhotoVerdict {
  /** true seulement si la correspondance est évidente. */
  match: boolean;
  /** Phrase pour le joueur, qui ne dévoile jamais la solution. */
  reason: string;
}

export interface PhotoJudge {
  judge(c: PhotoCase): Promise<PhotoVerdict>;
}

const VerdictSchema = z.object({
  samePlace: z.boolean().describe('La photo du joueur montre le lieu ou l’objet attendu'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Certitude de cette conclusion'),
  reason: z.string().describe('Une phrase en français pour le joueur, en vouvoiement, sans jamais nommer ni décrire le lieu attendu'),
});

const SYSTEM = `Tu es l'arbitre photo de Treasure Hunters, une application de chasses au trésor.
Une équipe n'a pas trouvé le QR code caché sur un lieu (arraché, abîmé ou déplacé) : elle envoie à la place une photo de ce qu'elle pense être la solution de l'énigme.
Tu dis si sa photo montre bien le lieu ou l'objet attendu.

Règles :
- Compare avec la photo de référence de l'organisateur quand elle est fournie : même monument, même objet, même point de vue approximatif. L'angle, la lumière, la saison et les passants peuvent changer.
- Sans photo de référence, juge d'après la description du lieu et l'énigme.
- samePlace = true avec confidence = high uniquement si la correspondance est évidente. Au moindre doute sérieux, baisse la certitude.
- Une photo floue, de l'écran d'un autre appareil, d'une image trouvée en ligne ou sans rapport ne correspond pas.
- reason s'adresse à l'équipe : elle ne doit JAMAIS nommer, décrire ou suggérer le lieu attendu, puisque l'équipe le cherche encore. Exemple : « La photo ne semble pas montrer le lieu de l'énigme. » ou « Le lieu est bien reconnu. »`;

function image(p: StoredPhoto): Anthropic.Beta.BetaImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: p.contentType as 'image/jpeg' | 'image/png' | 'image/webp', data: p.bytes.toString('base64') },
  };
}

export class ClaudePhotoJudge implements PhotoJudge {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    const workspace = config.anthropicWorkspaceId;
    this.client = new Anthropic({ apiKey, defaultHeaders: workspace ? { 'anthropic-workspace-id': workspace } : undefined });
  }

  async judge(c: PhotoCase): Promise<PhotoVerdict> {
    const description = [
      `Lieu attendu : ${c.place.title}`,
      c.place.address ? `Adresse : ${c.place.address}` : null,
      c.place.arrival ? `Message affiché à l'arrivée : ${c.place.arrival}` : null,
      c.riddle ? `Énigme qui y mène : ${c.riddle}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: description }];
    if (c.reference) content.push({ type: 'text', text: 'Photo de référence, prise par l’organisateur sur le lieu :' }, image(c.reference));
    else content.push({ type: 'text', text: 'Pas de photo de référence pour ce lieu.' });
    content.push({ type: 'text', text: 'Photo envoyée par l’équipe :' }, image(c.photo));

    const message = await this.client.beta.messages
      .stream({
        model: config.generatorModel,
        max_tokens: 16_000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: betaZodOutputFormat(VerdictSchema) },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content }],
      })
      .finalMessage();
    const v = message.stop_reason === 'refusal' ? null : message.parsed_output;
    if (!v) throw new Error(`Avis photo illisible (stop_reason=${message.stop_reason})`);
    return { match: v.samePlace && v.confidence === 'high', reason: v.reason.slice(0, 500) };
  }
}
