/**
 * Skins de chasse (docs/skins.md) : l'habillage que voient les joueurs d'une chasse —
 * carnet de route, page d'invitation, résultats. Un skin est une **donnée** : des valeurs
 * pour une liste fermée de jetons de style, des polices, une couverture, des sons et des
 * effets. Aucun code ni CSS libre : c'est ce qui permettra d'accueillir plus tard les skins
 * de créateurs (marketplace) sans risque pour l'application.
 */

/** Jetons qu'un skin peut redéfinir ; chacun devient la variable CSS `--th-<nom>`. */
export const SKIN_TOKENS = [
  // Couleurs
  'page-bg',
  'ink',
  'ink-soft',
  'primary',
  'primary-light',
  'on-primary',
  'secondary',
  'accent',
  'accent-light',
  'success',
  'danger',
  'neutral',
  'border',
  'surface',
  'surface-raised',
  'surface-sunken',
  // Bouton d'action principal
  'cta',
  'on-cta',
  // Polices
  'font-body',
  'font-title',
  'font-display',
  'font-note',
  // Formes et matières
  'radius',
  'shadow',
  'texture',
  'surface-bg',
  'surface-border',
  'surface-shadow',
  'banner-bg',
  'banner-ink',
  'banner-title',
  'banner-outline',
  // Titres
  'heading-ink',
  'title-weight',
  'title-case',
  'title-spacing',
  'display-weight',
  'display-spacing',
  'display-shadow',
  'section-rules',
  'section-ink',
  // Énigmes et tampons
  'note-size',
  'stamp-rotate',
  'stamp-border',
  'tape',
] as const;
export type SkinToken = (typeof SKIN_TOKENS)[number];

/** Moments de la partie qui peuvent jouer un son. */
export type SkinSoundEvent = 'validate' | 'hint' | 'treasure';

/**
 * Un son : un fichier (URL https ou data:audio), ou une courte suite de notes synthétisées
 * dans le navigateur ([fréquence en Hz, durée en ms] ; fréquence 0 = silence).
 */
export type SkinSound = { url: string } | { tones: [number, number][]; wave?: 'sine' | 'square' | 'triangle' | 'sawtooth' };

export interface SkinFont {
  family: string;
  /** Fichier woff2 (https) ; les polices des skins intégrés sont livrées avec l'application. */
  url: string;
  weight?: string;
  style?: 'normal' | 'italic';
}

export interface SkinManifest {
  /** Identifiant stable, en minuscules : `hun_skin`. */
  id: string;
  name: string;
  description: string;
  author: string;
  /** Prix en centimes d'euro ; 0 = offert. */
  price: number;
  /** Clair ou sombre : réglages du navigateur (barres de défilement, champs). */
  scheme: 'light' | 'dark';
  tokens: Partial<Record<SkinToken, string>>;
  fonts?: SkinFont[];
  /** Image de couverture (cartes de chasse, choix du skin) : URL https ou data:image. */
  cover: string;
  sounds?: Partial<Record<SkinSoundEvent, SkinSound>>;
  effects?: {
    /** Animation à la validation d'une étape. */
    validate?: 'stamp' | 'pulse' | 'none';
    /** Animation à la découverte du trésor. */
    treasure?: 'confetti' | 'none';
    /** Couleurs des confettis. */
    confetti?: string[];
  };
}

/* ---------------------------------------------------------------- Contrôle */

const FORBIDDEN = /[;{}<>\\]|@import|expression\s*\(|javascript:/i;
const URLS = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

/** Une URL qu'un skin a le droit de charger : https, ou image / police / son en data:. */
export function safeSkinUrl(url: string): boolean {
  return /^https:\/\/[^\s"'()]+$/i.test(url) || /^data:(image\/(png|jpeg|webp|gif|svg\+xml)|font\/woff2|audio\/(mpeg|ogg|wav|webm))[;,]/i.test(url);
}

/** Valeur de jeton acceptable : pas de quoi sortir de la déclaration CSS, et seulement des URL sûres. */
export function safeTokenValue(value: string): boolean {
  if (typeof value !== 'string' || value.length > 4000) return false;
  // Les data: SVG contiennent < > ; ; on contrôle ce qui reste une fois les url(...) retirées.
  const outside = value.replace(URLS, '');
  if (FORBIDDEN.test(outside)) return false;
  return [...value.matchAll(URLS)].every((m) => safeSkinUrl(m[2]));
}

/** Jetons d'un skin qui passent le contrôle ; les autres sont ignorés. */
export function skinStyle(skin: SkinManifest): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [token, value] of Object.entries(skin.tokens)) {
    if ((SKIN_TOKENS as readonly string[]).includes(token) && value !== undefined && safeTokenValue(value)) style[`--th-${token}`] = value;
  }
  return style;
}

/* ---------------------------------------------------------------- Skins intégrés */

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(body)}`;

/** Grain de papier (bruit fractal). */
const PAPER_GRAIN = `url("${svg(
  `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .35 0 0 0 0 .22 0 0 0 0 .08 0 0 0 .09 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}")`;

/** Ciel étoilé. */
const STARS = `url("${svg(
  `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><g fill='#fff'>${[
    [12, 20, 1.1, 0.9], [60, 80, 0.7, 0.6], [110, 30, 1.3, 0.8], [180, 60, 0.8, 0.5], [220, 140, 1, 0.7], [30, 150, 0.9, 0.6],
    [90, 200, 1.2, 0.8], [150, 170, 0.6, 0.5], [200, 220, 0.9, 0.6], [130, 110, 0.5, 0.4], [70, 130, 0.6, 0.5], [230, 10, 0.7, 0.5],
  ]
    .map(([x, y, r, o]) => `<circle cx='${x}' cy='${y}' r='${r}' opacity='${o}'/>`)
    .join('')}</g></svg>`,
)}")`;

const COVER_EPURE = svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#e8eefb'/><stop offset='1' stop-color='#c9d7f2'/></linearGradient></defs>
<rect width='320' height='180' fill='url(#g)'/>
<g fill='none' stroke='#9fb3d9' stroke-width='2'><path d='M0 130 Q80 90 160 120 T320 100'/><path d='M0 150 Q90 120 170 140 T320 125' opacity='.6'/></g>
<g transform='translate(160 78)'><circle r='38' fill='#fff' stroke='#1d4ed8' stroke-width='4'/><path d='M0 -30 L8 0 L-8 0 Z' fill='#e4572e'/><path d='M0 30 L8 0 L-8 0 Z' fill='#13294b'/><circle r='4' fill='#13294b'/></g>
</svg>`);

const COVER_AVENTURE = svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
<rect width='320' height='180' fill='#e9d3a1'/>
<rect width='320' height='180' fill='#f6e7c4' opacity='.5'/>
<path d='M-10 150 Q60 110 120 135 T250 120 T340 130 V190 H-10 Z' fill='#6b6b3a' opacity='.55'/>
<path d='M40 40 C90 60 80 110 140 100 S220 60 270 95' fill='none' stroke='#9e2b1f' stroke-width='3' stroke-dasharray='8 7'/>
<g transform='translate(276 100) rotate(45)' stroke='#9e2b1f' stroke-width='5' stroke-linecap='round'><line x1='-11' y1='0' x2='11' y2='0'/><line x1='0' y1='-11' x2='0' y2='11'/></g>
<g transform='translate(52 42)' fill='#3d2413'><circle r='22' fill='none' stroke='#3d2413' stroke-width='3'/><path d='M0 -19 L5 0 L0 19 L-5 0 Z'/><path d='M0 -19 L5 0 L-5 0 Z' fill='#9e2b1f'/></g>
<rect x='6' y='6' width='308' height='168' fill='none' stroke='#8b5a2b' stroke-width='2' stroke-dasharray='3 4' opacity='.6'/>
</svg>`);

const COVER_SPATIAL = svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
<defs><radialGradient id='s' cx='.25' cy='.1' r='1'><stop offset='0' stop-color='#2a3a86'/><stop offset='.6' stop-color='#0b1030'/><stop offset='1' stop-color='#060818'/></radialGradient>
<linearGradient id='p' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#ff7ad9'/><stop offset='1' stop-color='#6a3df0'/></linearGradient></defs>
<rect width='320' height='180' fill='url(#s)'/>
<g fill='#fff'><circle cx='30' cy='30' r='1.2'/><circle cx='80' cy='120' r='.8'/><circle cx='140' cy='20' r='1'/><circle cx='200' cy='150' r='1.1'/><circle cx='300' cy='40' r='.9'/><circle cx='250' cy='20' r='.7'/><circle cx='20' cy='160' r='.8'/><circle cx='110' cy='70' r='.6'/></g>
<circle cx='225' cy='95' r='46' fill='url(#p)'/>
<ellipse cx='225' cy='95' rx='78' ry='14' fill='none' stroke='#5ee7ff' stroke-width='3' transform='rotate(-18 225 95)'/>
<path d='M60 120 l14 -40 l14 40 l-14 -8 Z' fill='#e6ecff'/><path d='M67 122 l7 16 l7 -16 Z' fill='#ffb347'/>
</svg>`);

export const SKINS: SkinManifest[] = [
  {
    id: 'aventure',
    name: 'Aventure',
    description: 'Carnet d’explorateur : parchemin, cuir cousu, tampons encrés et écriture à la machine.',
    author: 'Treasure Hunters',
    price: 0,
    scheme: 'light',
    cover: COVER_AVENTURE,
    tokens: {
      'page-bg':
        'radial-gradient(ellipse at 50% 0%, rgba(255, 248, 225, 0.9), transparent 60%), radial-gradient(ellipse at 100% 100%, rgba(139, 90, 43, 0.25), transparent 55%), radial-gradient(ellipse at 0% 80%, rgba(107, 107, 58, 0.18), transparent 50%), #f1e2bf',
      ink: '#2b1d12',
      'ink-soft': '#6b5640',
      primary: '#3d2413',
      'primary-light': '#6a4124',
      'on-primary': '#f6e7c4',
      secondary: '#8b5a2b',
      accent: '#c8962e',
      'accent-light': '#ecc970',
      success: '#3f5a36',
      danger: '#9e2b1f',
      neutral: '#6b6b3a',
      border: '#b8965d',
      surface: '#f1e2bf',
      'surface-raised': '#f9f0da',
      'surface-sunken': '#dcc493',
      cta: '#835425',
      'on-cta': '#ffffff',
      'font-display': "'Rye', 'Cinzel', serif",
      'font-title': "'Cinzel', Georgia, serif",
      'font-body': "'Lora', Georgia, serif",
      'font-note': "'Special Elite', 'Courier New', monospace",
      radius: '6px',
      shadow: '0 1px 0 rgba(255, 255, 255, 0.5) inset, 0 2px 6px rgba(61, 36, 19, 0.25)',
      texture: PAPER_GRAIN,
      'surface-bg': 'linear-gradient(160deg, #f9f0da, #efdfb8 70%, #e6d09f)',
      'surface-border': '1px solid #b8965d',
      'surface-shadow': '0 1px 0 rgba(255, 255, 255, 0.5) inset, 0 2px 6px rgba(61, 36, 19, 0.25), inset 0 0 40px rgba(139, 90, 43, 0.15)',
      'banner-bg': 'linear-gradient(170deg, #6a4124, #3d2413)',
      'banner-ink': '#e8d6b0',
      'banner-title': '#ecc970',
      'banner-outline': '1px dashed rgba(236, 201, 112, 0.55)',
      'heading-ink': '#3d2413',
      'title-weight': '700',
      'title-case': 'uppercase',
      'title-spacing': '0.14em',
      'display-weight': '400',
      'display-spacing': '0.02em',
      'display-shadow': '0 1px 0 rgba(255, 240, 200, 0.7)',
      'section-rules': 'block',
      'section-ink': '#8b5a2b',
      'note-size': '1.05rem',
      'stamp-rotate': '-6deg',
      'stamp-border': '3px double currentColor',
      tape: 'block',
    },
    sounds: {
      validate: { tones: [[523, 90], [659, 90], [784, 160]], wave: 'triangle' },
      hint: { tones: [[392, 120], [330, 160]], wave: 'triangle' },
      treasure: { tones: [[523, 110], [659, 110], [784, 110], [1047, 320]], wave: 'triangle' },
    },
    effects: { validate: 'stamp', treasure: 'confetti', confetti: ['#c8962e', '#ecc970', '#9e2b1f', '#3f5a36', '#8b5a2b'] },
  },
  {
    id: 'epure',
    name: 'Épuré',
    description: 'Clair et net, aux couleurs de l’application : idéal pour une chasse d’entreprise ou une visite.',
    author: 'Treasure Hunters',
    price: 0,
    scheme: 'light',
    cover: COVER_EPURE,
    tokens: {},
    sounds: {
      validate: { tones: [[660, 70], [880, 120]], wave: 'sine' },
      hint: { tones: [[440, 120]], wave: 'sine' },
      treasure: { tones: [[660, 100], [880, 100], [1320, 260]], wave: 'sine' },
    },
    effects: { validate: 'pulse', treasure: 'confetti', confetti: ['#1d4ed8', '#f2a93b', '#15803d', '#13294b'] },
  },
  {
    id: 'spatial',
    name: 'Mission spatiale',
    description: 'Nuit étoilée, écrans de bord et néons : pour une chasse futuriste ou une soirée.',
    author: 'Treasure Hunters',
    price: 0,
    scheme: 'dark',
    cover: COVER_SPATIAL,
    tokens: {
      'page-bg':
        'radial-gradient(ellipse at 15% 0%, rgba(42, 58, 134, 0.9), transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(106, 61, 240, 0.35), transparent 50%), #070b1f',
      ink: '#e6ecff',
      'ink-soft': '#9aa8d6',
      primary: '#0b1026',
      'primary-light': '#1c2a5e',
      'on-primary': '#e6ecff',
      secondary: '#5ee7ff',
      accent: '#ff7ad9',
      'accent-light': '#ffd6f3',
      success: '#3ef0a1',
      danger: '#ff5470',
      neutral: '#6a78a8',
      border: 'rgba(94, 231, 255, 0.28)',
      surface: '#121a3a',
      'surface-raised': 'rgba(20, 29, 66, 0.88)',
      'surface-sunken': '#0d1430',
      cta: '#5ee7ff',
      'on-cta': '#06101f',
      'font-display': "'Orbitron', 'Inter', sans-serif",
      'font-title': "'Orbitron', 'Inter', sans-serif",
      'font-body': "'Inter', system-ui, sans-serif",
      'font-note': "'Inter', system-ui, sans-serif",
      radius: '14px',
      shadow: '0 0 0 1px rgba(94, 231, 255, 0.18), 0 8px 24px rgba(0, 0, 0, 0.45)',
      texture: STARS,
      'surface-bg': 'linear-gradient(160deg, rgba(28, 42, 94, 0.92), rgba(13, 20, 48, 0.92))',
      'surface-border': '1px solid rgba(94, 231, 255, 0.28)',
      'surface-shadow': '0 0 0 1px rgba(94, 231, 255, 0.08), 0 10px 30px rgba(0, 0, 0, 0.45)',
      'banner-bg': 'linear-gradient(135deg, #1c2a5e, #0b1026 70%)',
      'banner-ink': '#b9c6f0',
      'banner-title': '#5ee7ff',
      'banner-outline': '1px solid rgba(94, 231, 255, 0.35)',
      'heading-ink': '#e6ecff',
      'title-weight': '700',
      'title-case': 'uppercase',
      'title-spacing': '0.12em',
      'display-weight': '700',
      'display-spacing': '0.06em',
      'display-shadow': '0 0 14px rgba(94, 231, 255, 0.55)',
      'section-rules': 'block',
      'section-ink': '#5ee7ff',
      'note-size': '1.02rem',
      'stamp-rotate': '-4deg',
      'stamp-border': '2px solid currentColor',
    },
    sounds: {
      validate: { tones: [[880, 60], [0, 30], [1320, 120]], wave: 'square' },
      hint: { tones: [[520, 80], [390, 120]], wave: 'square' },
      treasure: { tones: [[440, 90], [660, 90], [880, 90], [1320, 90], [1760, 280]], wave: 'sawtooth' },
    },
    effects: { validate: 'pulse', treasure: 'confetti', confetti: ['#5ee7ff', '#ff7ad9', '#3ef0a1', '#ffd6f3', '#6a3df0'] },
  },
];

/** Skin des chasses qui n'en choisissent pas (et des chasses existantes). */
export const DEFAULT_SKIN = 'aventure';
export const SKIN_IDS = SKINS.map((s) => s.id) as [string, ...string[]];

export function skinById(id: string | null | undefined): SkinManifest {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN)!;
}
