/**
 * Import d'un parcours (docs/conception.md § 31) : une liste de lieux collée (un par ligne, avec
 * ou sans coordonnées) ou un fichier GPX (points de passage ou d'itinéraire). Chaque lieu
 * devient une étape ; ceux sans coordonnées restent à placer sur la carte.
 */

export interface ImportedPlace {
  title: string;
  lat: number | null;
  lng: number | null;
}

export interface ImportResult {
  places: ImportedPlace[];
  /** Ce qui n'a pas pu être lu, pour le dire à l'auteur. */
  problems: string[];
}

/** Lieux importés au plus d'un coup. */
export const IMPORT_MAX = 30;

const COORDS = /(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})/;

function valid(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function clean(title: string): string {
  return title
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^[\s\d.)\-–•*]+(?=\D)/, '')
    .replace(/[\s,;:|\-–@]+$/g, '')
    .replace(/^[\s,;:|\-–]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 255);
}

function decode(xml: string): string {
  return xml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Une ligne par lieu : « Nom ; 43.61, 3.87 », « 43.61,3.87 Nom », un lien de carte, ou seulement un nom. */
export function parsePlaceList(text: string): ImportResult {
  const places: ImportedPlace[] = [];
  const problems: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = COORDS.exec(line);
    let lat: number | null = null;
    let lng: number | null = null;
    // Un lien de carte porte les coordonnées, pas le nom.
    let title = line.replace(/https?:\/\/\S+/g, ' ');
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (valid(a, b)) {
        lat = a;
        lng = b;
      } else problems.push(`Coordonnées impossibles : « ${line.slice(0, 60)} ».`);
      title = title.replace(m[0], ' ');
    }
    title = clean(title) || `Lieu ${places.length + 1}`;
    places.push({ title, lat, lng });
  }
  return limit(places, problems);
}

/** Fichier GPX : les points de passage (wpt), sinon les points d'itinéraire (rtept). */
export function parseGpx(xml: string): ImportResult {
  const problems: string[] = [];
  const read = (tag: 'wpt' | 'rtept'): ImportedPlace[] => {
    const out: ImportedPlace[] = [];
    const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'gi');
    for (const m of xml.matchAll(re)) {
      const attrs = m[1] ?? '';
      const lat = Number(/\blat\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
      const lng = Number(/\blon\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]);
      const name = /<name>([\s\S]*?)<\/name>/i.exec(m[2] ?? '')?.[1];
      if (!valid(lat, lng)) {
        problems.push('Un point sans coordonnées lisibles a été ignoré.');
        continue;
      }
      out.push({ title: clean(decode(name ?? '')) || `Lieu ${out.length + 1}`, lat, lng });
    }
    return out;
  };
  let places = read('wpt');
  if (!places.length) places = read('rtept');
  if (!places.length) {
    problems.push(
      /<trkpt\b/i.test(xml)
        ? 'Ce fichier ne contient qu’une trace : ajoutez-y des points de passage (vos lieux), puis importez-le à nouveau.'
        : 'Aucun lieu trouvé dans ce fichier GPX.',
    );
  }
  return limit(places, problems);
}

function limit(places: ImportedPlace[], problems: string[]): ImportResult {
  if (places.length > IMPORT_MAX) {
    problems.push(`Seuls les ${IMPORT_MAX} premiers lieux sont importés.`);
    places = places.slice(0, IMPORT_MAX);
  }
  return { places, problems };
}
