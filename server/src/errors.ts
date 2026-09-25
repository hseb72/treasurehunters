/** Erreur métier renvoyée au client sous la forme { message } avec le statut HTTP donné. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Cause technique, journalisée côté serveur mais jamais renvoyée au client. */
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = 'Connectez-vous pour continuer.') => new HttpError(401, m);
export const forbidden = (m: string) => new HttpError(403, m);
export const notFound = (m: string) => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

/**
 * Erreur et ses causes sur une ligne, pour les journaux : « fetch failed ← connect ETIMEDOUT 1.2.3.4:443 ».
 * `fetch` ne dit que « fetch failed » : la raison réseau (DNS, refus, délai, TLS) est dans `cause`.
 */
export function describeError(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur !== undefined && cur !== null && depth < 6; depth++) {
    if (!(cur instanceof Error)) {
      parts.push(String(cur));
      break;
    }
    const code = (cur as { code?: unknown }).code;
    const text = cur.message || cur.name;
    parts.push(typeof code === 'string' && !text.includes(code) ? `${text} [${code}]` : text);
    // Plusieurs adresses essayées (IPv6 puis IPv4) : une erreur par adresse.
    if (cur instanceof AggregateError && cur.errors.length) {
      parts.push(cur.errors.map(describeError).join(' / '));
      break;
    }
    cur = cur.cause;
  }
  return parts.join(' ← ');
}
