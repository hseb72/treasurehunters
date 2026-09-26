/**
 * Stockage des photos (§ 12) : le MinIO mutualisé du socle, via l'API S3.
 * Trois opérations suffisent (déposer, lire, supprimer) : elles sont signées ici
 * (AWS Signature v4) plutôt que confiées à un client S3 complet et à ses dépendances.
 */
import { createHash, createHmac } from 'node:crypto';

export interface StoredPhoto {
  bytes: Buffer;
  contentType: string;
}

export interface PhotoStore {
  put(key: string, photo: StoredPhoto): Promise<void>;
  get(key: string): Promise<StoredPhoto | null>;
  delete(key: string): Promise<void>;
}

export interface S3Config {
  /** Ex. http://minio.object-store.svc.cluster.local:9000 */
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/**
 * En-têtes signés (AWS Signature v4) d'une requête S3 sans paramètres de requête.
 * `now` et les en-têtes supplémentaires servent aux tests (vecteurs de la documentation AWS).
 */
export function signS3(
  req: { method: string; url: URL; payloadHash: string; headers?: Record<string, string> },
  cred: { accessKey: string; secretKey: string; region: string },
  now = new Date(),
): Record<string, string> {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: req.url.host,
    'x-amz-content-sha256': req.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    req.method,
    req.url.pathname,
    '',
    ...names.map((n) => `${n}:${headers[n]}`),
    '',
    names.join(';'),
    req.payloadHash,
  ].join('\n');
  const scope = `${day}/${cred.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${cred.secretKey}`, day), cred.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

export class S3PhotoStore implements PhotoStore {
  constructor(private readonly cfg: S3Config) {}

  private url(key: string): URL {
    const path = [this.cfg.bucket, ...key.split('/')].map(encodeURIComponent).join('/');
    return new URL(`${this.cfg.endpoint.replace(/\/+$/, '')}/${path}`);
  }

  private async send(method: string, key: string, body?: Buffer, headers: Record<string, string> = {}): Promise<Response> {
    const url = this.url(key);
    const signed = signS3({ method, url, payloadHash: sha256(body ?? ''), headers }, this.cfg);
    const { host: _host, ...sent } = signed; // posé par fetch lui-même
    return fetch(url, { method, headers: sent, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(20_000) });
  }

  async put(key: string, photo: StoredPhoto): Promise<void> {
    const res = await this.send('PUT', key, photo.bytes, { 'content-type': photo.contentType });
    if (!res.ok) throw new Error(`Stockage : dépôt de ${key} refusé (${res.status}) : ${(await res.text()).slice(0, 200)}`);
  }

  async get(key: string): Promise<StoredPhoto | null> {
    const res = await this.send('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Stockage : lecture de ${key} refusée (${res.status}) : ${(await res.text()).slice(0, 200)}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'image/jpeg' };
  }

  async delete(key: string): Promise<void> {
    const res = await this.send('DELETE', key);
    if (!res.ok && res.status !== 404) throw new Error(`Stockage : suppression de ${key} refusée (${res.status})`);
  }
}

/** Stockage en mémoire : tests et serveur de développement sans MinIO. */
export class MemoryPhotoStore implements PhotoStore {
  readonly objects = new Map<string, StoredPhoto>();
  async put(key: string, photo: StoredPhoto): Promise<void> {
    this.objects.set(key, photo);
  }
  async get(key: string): Promise<StoredPhoto | null> {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** Formats acceptés, reconnus à leurs premiers octets (jamais au type annoncé). */
export function imageType(bytes: Buffer): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
