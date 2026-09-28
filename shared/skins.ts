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
  // Texte dans les cartes, quand il diffère du texte posé sur la page (parchemin clair sur fond sombre)
  'surface-ink',
  'surface-ink-soft',
  'surface-heading',
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

const COVER_MEDIEVAL = svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
<defs><linearGradient id='c' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#8b2323'/><stop offset='1' stop-color='#f0b56b'/></linearGradient></defs>
<rect width='320' height='180' fill='url(#c)'/>
<circle cx='250' cy='60' r='22' fill='#f7d98a' opacity='.9'/>
<path d='M0 150 Q80 110 160 130 T320 120 V180 H0 Z' fill='#3a2a1a'/>
<g fill='#2a1b12'><rect x='110' y='70' width='100' height='70'/><rect x='95' y='50' width='26' height='90'/><rect x='199' y='50' width='26' height='90'/><rect x='145' y='40' width='30' height='100'/>
<path d='M95 50 h6 v-8 h6 v8 h8 v-8 h6 v8 z M199 50 h6 v-8 h6 v8 h8 v-8 h6 v8 z M145 40 h6 v-8 h6 v8 h6 v-8 h6 v8 z'/></g>
<path d='M160 40 V14' stroke='#2a1b12' stroke-width='2'/><path d='M160 14 L182 20 L160 26 Z' fill='#d4a64a'/>
<path d='M150 140 v-18 a10 10 0 0 1 20 0 v18 Z' fill='#f0b56b' opacity='.6'/>
<rect x='5' y='5' width='310' height='170' fill='none' stroke='#d4a64a' stroke-width='3'/>
</svg>`);

const COVER_PIRATES = svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
<defs><linearGradient id='k' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#ffd699'/><stop offset='.55' stop-color='#58b4ae'/><stop offset='1' stop-color='#0c3b44'/></linearGradient></defs>
<rect width='320' height='180' fill='url(#k)'/>
<circle cx='80' cy='70' r='24' fill='#fff1c9' opacity='.9'/>
<g fill='#3b2410'><path d='M140 128 h110 l-14 22 h-82 z'/><rect x='193' y='40' width='4' height='90'/><rect x='160' y='60' width='3' height='70'/></g>
<g fill='#f6e8c6'><path d='M199 44 q30 20 0 60 z'/><path d='M165 64 q22 16 0 44 z'/></g>
<path d='M197 40 l16 6 l-16 6 z' fill='#1a1a1a'/>
<g fill='none' stroke='#e9fbff' stroke-width='2' opacity='.7'><path d='M0 150 q20 -8 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0'/><path d='M0 165 q20 -8 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0'/></g>
<rect x='4' y='4' width='312' height='172' fill='none' stroke='#8a6a3d' stroke-width='4' stroke-dasharray='10 4'/>
</svg>`);

const COVER_ESPION = svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
<rect width='320' height='180' fill='#0d0f12'/>
<g stroke='#2a2f36' stroke-width='1'>${Array.from({ length: 16 }, (_, i) => `<line x1='${i * 20}' y1='0' x2='${i * 20}' y2='180'/>`).join('')}${Array.from({ length: 9 }, (_, i) => `<line x1='0' y1='${i * 20}' x2='320' y2='${i * 20}'/>`).join('')}</g>
<g fill='none' stroke='#e5e7eb' stroke-width='2' opacity='.85'><circle cx='130' cy='92' r='46'/><circle cx='130' cy='92' r='6'/><line x1='130' y1='36' x2='130' y2='70'/><line x1='130' y1='114' x2='130' y2='148'/><line x1='74' y1='92' x2='108' y2='92'/><line x1='152' y1='92' x2='186' y2='92'/></g>
<g transform='translate(236 40) rotate(-8)'><rect x='-58' y='-14' width='116' height='28' fill='none' stroke='#e11d2e' stroke-width='3'/><text x='0' y='6' text-anchor='middle' font-family='Arial, sans-serif' font-weight='700' font-size='15' fill='#e11d2e' letter-spacing='2'>CONFIDENTIEL</text></g>
<rect x='200' y='120' width='90' height='8' fill='#e11d2e' opacity='.8'/><rect x='200' y='136' width='60' height='8' fill='#4b5563'/>
</svg>`);

const gear = (cx: number, cy: number, r: number, color: string) =>
  `<g transform='translate(${cx} ${cy})'><circle r='${r}' fill='none' stroke='${color}' stroke-width='${r * 0.35}' stroke-dasharray='${r * 0.4} ${r * 0.28}'/><circle r='${r * 0.78}' fill='${color}'/><circle r='${r * 0.3}' fill='#2a1a10'/></g>`;

const COVER_STEAMPUNK = svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
<defs><radialGradient id='b' cx='.5' cy='.3' r='.9'><stop offset='0' stop-color='#6b4423'/><stop offset='1' stop-color='#1c110a'/></radialGradient></defs>
<rect width='320' height='180' fill='url(#b)'/>
${gear(90, 95, 46, '#b08d57')}${gear(165, 60, 26, '#c77b30')}${gear(230, 115, 36, '#8a6d4b')}
<g stroke='#c77b30' stroke-width='8' fill='none' stroke-linecap='round'><path d='M0 30 H60 Q80 30 80 50'/><path d='M320 150 H270 Q255 150 255 135'/></g>
<circle cx='270' cy='45' r='20' fill='#f0c27b' stroke='#b08d57' stroke-width='5'/><path d='M270 45 L270 32 M270 45 L280 50' stroke='#2a1a10' stroke-width='3'/>
<rect x='5' y='5' width='310' height='170' rx='10' fill='none' stroke='#b08d57' stroke-width='3'/>
</svg>`);

const COVER_FANTASTIQUE = svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
<defs><radialGradient id='f' cx='.5' cy='.25' r='.9'><stop offset='0' stop-color='#2a9d8f'/><stop offset='.6' stop-color='#0f3b3a'/><stop offset='1' stop-color='#081c1c'/></radialGradient></defs>
<rect width='320' height='180' fill='url(#f)'/>
<circle cx='160' cy='52' r='26' fill='#f7e3a6' opacity='.95'/><circle cx='160' cy='52' r='40' fill='#f7e3a6' opacity='.15'/>
<g fill='#0a2323'><path d='M0 180 V120 l20 -40 l20 40 l15 -30 l18 30 V180 Z'/><path d='M320 180 V110 l-18 -44 l-18 44 l-16 -28 l-18 28 V180 Z'/>
<path d='M150 180 V104 h-8 l18 -34 l18 34 h-8 V180 Z'/></g>
<g fill='#e9c46a'>${[[40, 40], [90, 20], [230, 30], [280, 60], [120, 90], [210, 95], [60, 140], [260, 150]]
  .map(([x, y]) => `<path d='M${x} ${y - 4} L${x + 1.2} ${y - 1.2} L${x + 4} ${y} L${x + 1.2} ${y + 1.2} L${x} ${y + 4} L${x - 1.2} ${y + 1.2} L${x - 4} ${y} L${x - 1.2} ${y - 1.2} Z'/>`)
  .join('')}</g>
<rect x='5' y='5' width='310' height='170' rx='14' fill='none' stroke='#e9c46a' stroke-width='2' opacity='.7'/>
</svg>`);

/** Poussière d'étoiles dorée (skin Fantastique). */
const SPARKLES = `url("${svg(
  `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><g fill='#e9c46a'>${[
    [20, 30, 1.2, 0.5], [90, 70, 0.8, 0.4], [170, 20, 1, 0.45], [200, 120, 1.3, 0.4], [40, 170, 0.9, 0.35], [130, 190, 1.1, 0.4], [110, 120, 0.6, 0.3],
  ]
    .map(([x, y, r, o]) => `<circle cx='${x}' cy='${y}' r='${r}' opacity='${o}'/>`)
    .join('')}</g></svg>`,
)}")`;

/** Lignes de balayage d'écran (skin Espion). */
const SCANLINES = 'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 3px)';

export const SKINS: SkinManifest[] = [
  {
    id: 'aventure',
    name: 'Aventurier',
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
    id: 'medieval',
    name: 'Médiéval',
    description: 'Châteaux, bannières et sceaux de cire : parchemin clair sur tenture pourpre.',
    author: 'Treasure Hunters',
    price: 0,
    scheme: 'dark',
    cover: COVER_MEDIEVAL,
    tokens: {
      'page-bg': 'radial-gradient(ellipse at 50% 0%, rgba(170, 50, 35, 0.45), transparent 60%), linear-gradient(180deg, #4a1010, #1e0707)',
      ink: '#f3e2c0',
      'ink-soft': '#d9b98a',
      'surface-ink': '#2b1a10',
      'surface-ink-soft': '#6b4a2e',
      'surface-heading': '#5a1414',
      primary: '#5a1414',
      'primary-light': '#8b2323',
      'on-primary': '#f6e3b8',
      secondary: '#8b2323',
      accent: '#d4a64a',
      'accent-light': '#f0d48a',
      success: '#3f6b2f',
      danger: '#a3201b',
      neutral: '#7a5c3a',
      border: '#b8904f',
      surface: '#efdcb3',
      'surface-raised': '#f5e6c4',
      'surface-sunken': '#dcc38f',
      cta: '#8b2323',
      'on-cta': '#f6e3b8',
      'font-display': "'MedievalSharp', 'Cinzel', serif",
      'font-title': "'Cinzel', Georgia, serif",
      'font-body': "'Lora', Georgia, serif",
      'font-note': "'Lora', Georgia, serif",
      radius: '4px',
      shadow: '0 3px 12px rgba(0, 0, 0, 0.45)',
      texture: PAPER_GRAIN,
      'surface-bg': 'linear-gradient(170deg, #f7e9c9, #ecd6a8 70%, #e0c48d)',
      'surface-border': '2px solid #b8904f',
      'surface-shadow': '0 0 0 3px rgba(90, 20, 20, 0.6), 0 6px 18px rgba(0, 0, 0, 0.5), inset 0 0 36px rgba(120, 70, 20, 0.25)',
      'banner-bg': 'linear-gradient(180deg, #7a1b1b, #4a0f0f)',
      'banner-ink': '#f0d9ae',
      'banner-title': '#f0d48a',
      'banner-outline': '2px solid rgba(212, 166, 74, 0.7)',
      'heading-ink': '#f0d48a',
      'title-weight': '700',
      'title-case': 'none',
      'title-spacing': '0.04em',
      'display-weight': '400',
      'display-spacing': '0.02em',
      'display-shadow': '0 2px 0 rgba(0, 0, 0, 0.5)',
      'section-rules': 'block',
      'section-ink': '#d4a64a',
      'note-size': '1.05rem',
      'stamp-rotate': '-8deg',
      'stamp-border': '3px double currentColor',
    },
    sounds: {
      validate: { tones: [[587, 120], [880, 260]], wave: 'triangle' },
      hint: { tones: [[440, 160]], wave: 'triangle' },
      treasure: { tones: [[523, 120], [659, 120], [784, 120], [1047, 360]], wave: 'triangle' },
    },
    effects: { validate: 'stamp', treasure: 'confetti', confetti: ['#d4a64a', '#8b2323', '#f0d48a', '#3f6b2f'] },
  },
  {
    id: 'pirates',
    name: 'Pirates',
    description: 'Cartes au trésor, cordages et bois de navire, sur une mer turquoise.',
    author: 'Treasure Hunters',
    price: 0,
    scheme: 'dark',
    cover: COVER_PIRATES,
    tokens: {
      'page-bg': 'radial-gradient(ellipse at 50% -10%, rgba(255, 214, 140, 0.35), transparent 55%), linear-gradient(180deg, #1a6b73, #0c3b44 70%, #082a31)',
      ink: '#f1f5e9',
      'ink-soft': '#bfe0dc',
      'surface-ink': '#2e1d0e',
      'surface-ink-soft': '#6b4b2b',
      'surface-heading': '#5b3a1e',
      primary: '#5b3a1e',
      'primary-light': '#8a5a2b',
      'on-primary': '#fbe9c6',
      secondary: '#1a6b73',
      accent: '#e9b949',
      'accent-light': '#fbe3a1',
      success: '#2f7d4f',
      danger: '#b3261e',
      neutral: '#7b6a4f',
      border: '#8a6a3d',
      surface: '#f0dfb6',
      'surface-raised': '#f6e8c6',
      'surface-sunken': '#dfc58f',
      cta: '#6b4423',
      'on-cta': '#fbe9c6',
      'font-display': "'Pirata One', 'Cinzel', serif",
      'font-title': "'Pirata One', Georgia, serif",
      'font-body': "'Lora', Georgia, serif",
      'font-note': "'Special Elite', 'Courier New', monospace",
      radius: '10px',
      shadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
      texture: PAPER_GRAIN,
      'surface-bg': 'linear-gradient(165deg, #f8ecce, #efd9a8 75%, #e4c88f)',
      'surface-border': '3px solid #8a6a3d',
      'surface-shadow': '0 0 0 2px rgba(60, 40, 20, 0.35), 0 8px 20px rgba(0, 0, 0, 0.4)',
      'banner-bg': 'linear-gradient(180deg, #7a5230, #4e3218)',
      'banner-ink': '#f5dfb3',
      'banner-title': '#fbe3a1',
      'banner-outline': '2px dashed rgba(251, 227, 161, 0.6)',
      'heading-ink': '#fbe3a1',
      'title-weight': '400',
      'title-case': 'none',
      'title-spacing': '0.02em',
      'display-weight': '400',
      'display-spacing': '0.03em',
      'display-shadow': '0 2px 0 rgba(0, 0, 0, 0.45)',
      'section-rules': 'block',
      'section-ink': '#fbe3a1',
      'note-size': '1.05rem',
      'stamp-rotate': '-5deg',
      'stamp-border': '3px solid currentColor',
      tape: 'block',
    },
    sounds: {
      validate: { tones: [[392, 90], [523, 90], [659, 200]], wave: 'triangle' },
      hint: { tones: [[330, 150], [294, 180]], wave: 'triangle' },
      treasure: { tones: [[392, 110], [523, 110], [659, 110], [784, 110], [1047, 320]], wave: 'triangle' },
    },
    effects: { validate: 'stamp', treasure: 'confetti', confetti: ['#e9b949', '#fbe3a1', '#1a6b73', '#b3261e'] },
  },
  {
    id: 'espion',
    name: 'Espion',
    description: 'Dossier confidentiel : écrans sombres, viseur, touches de rouge et police de télex.',
    author: 'Treasure Hunters',
    price: 0,
    scheme: 'dark',
    cover: COVER_ESPION,
    tokens: {
      'page-bg': 'radial-gradient(ellipse at 50% 0%, rgba(80, 90, 100, 0.35), transparent 60%), linear-gradient(180deg, #121417, #07080a)',
      ink: '#e8eaed',
      'ink-soft': '#9aa1a9',
      primary: '#0b0c0e',
      'primary-light': '#1c1f24',
      'on-primary': '#e8eaed',
      secondary: '#ff5a5a',
      accent: '#e11d2e',
      'accent-light': '#ff8a8a',
      success: '#34d399',
      danger: '#ff3b3b',
      neutral: '#4b5563',
      border: 'rgba(255, 255, 255, 0.14)',
      surface: '#15181c',
      'surface-raised': '#181b20',
      'surface-sunken': '#0e1013',
      cta: '#e11d2e',
      'on-cta': '#ffffff',
      'font-display': "'Bebas Neue', 'Inter', sans-serif",
      'font-title': "'Bebas Neue', 'Inter', sans-serif",
      'font-body': "'Inter', system-ui, sans-serif",
      'font-note': "'Share Tech Mono', ui-monospace, monospace",
      radius: '6px',
      shadow: '0 6px 18px rgba(0, 0, 0, 0.6)',
      texture: SCANLINES,
      'surface-bg': 'linear-gradient(180deg, #1b1f24, #121418)',
      'surface-border': '1px solid rgba(255, 255, 255, 0.12)',
      'surface-shadow': '0 0 0 1px rgba(225, 29, 46, 0.15), 0 10px 24px rgba(0, 0, 0, 0.6)',
      'banner-bg': 'linear-gradient(135deg, #1c1f24, #0b0c0e)',
      'banner-ink': '#c7ccd2',
      'banner-title': '#ffffff',
      'banner-outline': '1px solid rgba(225, 29, 46, 0.55)',
      'heading-ink': '#ffffff',
      'title-weight': '400',
      'title-case': 'uppercase',
      'title-spacing': '0.08em',
      'display-weight': '400',
      'display-spacing': '0.06em',
      'display-shadow': 'none',
      'section-rules': 'block',
      'section-ink': '#ff5a5a',
      'note-size': '1rem',
      'stamp-rotate': '-3deg',
      'stamp-border': '2px solid currentColor',
    },
    sounds: {
      validate: { tones: [[1200, 40], [0, 40], [1200, 40], [0, 40], [1600, 120]], wave: 'square' },
      hint: { tones: [[700, 60], [500, 100]], wave: 'square' },
      treasure: { tones: [[800, 80], [1000, 80], [1200, 80], [1600, 300]], wave: 'sawtooth' },
    },
    effects: { validate: 'pulse', treasure: 'confetti', confetti: ['#e11d2e', '#ffffff', '#9aa1a9'] },
  },
  {
    id: 'spatial',
    name: 'Science-fiction',
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
  {
    id: 'steampunk',
    name: 'Steampunk',
    description: 'Laiton, cuivre et engrenages : une chasse d’inventeurs à l’ère de la vapeur.',
    author: 'Treasure Hunters',
    price: 0,
    scheme: 'dark',
    cover: COVER_STEAMPUNK,
    tokens: {
      'page-bg': 'radial-gradient(ellipse at 50% 0%, rgba(199, 123, 48, 0.35), transparent 60%), linear-gradient(180deg, #3a2414, #1c110a)',
      ink: '#f3e3c3',
      'ink-soft': '#cfb48a',
      primary: '#24170e',
      'primary-light': '#5a3a1f',
      'on-primary': '#f3e3c3',
      secondary: '#e0a458',
      accent: '#c77b30',
      'accent-light': '#f0c27b',
      success: '#7fb069',
      danger: '#e0685f',
      neutral: '#8a6d4b',
      border: '#b08d57',
      surface: '#2c1d12',
      'surface-raised': '#33221a',
      'surface-sunken': '#24170e',
      cta: '#b87333',
      'on-cta': '#1c110a',
      'font-display': "'Cinzel Decorative', 'Cinzel', serif",
      'font-title': "'Cinzel', Georgia, serif",
      'font-body': "'Lora', Georgia, serif",
      'font-note': "'Special Elite', 'Courier New', monospace",
      radius: '12px',
      shadow: '0 6px 18px rgba(0, 0, 0, 0.5)',
      'surface-bg': 'radial-gradient(ellipse at 50% 0%, rgba(240, 194, 123, 0.12), transparent 60%), linear-gradient(170deg, #3b2718, #25170d)',
      'surface-border': '2px solid #b08d57',
      'surface-shadow': '0 0 0 4px rgba(176, 141, 87, 0.25), inset 0 0 0 1px rgba(255, 220, 160, 0.15), 0 10px 24px rgba(0, 0, 0, 0.55)',
      'banner-bg': 'linear-gradient(180deg, #6b4423, #3a2414)',
      'banner-ink': '#ead2a8',
      'banner-title': '#f0c27b',
      'banner-outline': '2px solid #b08d57',
      'heading-ink': '#f0c27b',
      'title-weight': '700',
      'title-case': 'uppercase',
      'title-spacing': '0.1em',
      'display-weight': '700',
      'display-spacing': '0.04em',
      'display-shadow': '0 2px 0 rgba(0, 0, 0, 0.6)',
      'section-rules': 'block',
      'section-ink': '#e0a458',
      'note-size': '1.05rem',
      'stamp-rotate': '-6deg',
      'stamp-border': '3px double currentColor',
    },
    sounds: {
      validate: { tones: [[330, 60], [0, 20], [660, 60], [990, 160]], wave: 'triangle' },
      hint: { tones: [[262, 100], [330, 140]], wave: 'triangle' },
      treasure: { tones: [[262, 120], [392, 120], [523, 120], [784, 360]], wave: 'sawtooth' },
    },
    effects: { validate: 'stamp', treasure: 'confetti', confetti: ['#c77b30', '#f0c27b', '#b08d57', '#7fb069'] },
  },
  {
    id: 'fantastique',
    name: 'Fantastique',
    description: 'Forêts enchantées, lueurs magiques et enluminures dorées.',
    author: 'Treasure Hunters',
    price: 0,
    scheme: 'dark',
    cover: COVER_FANTASTIQUE,
    tokens: {
      'page-bg':
        'radial-gradient(ellipse at 50% 0%, rgba(94, 234, 212, 0.25), transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(233, 196, 106, 0.18), transparent 50%), linear-gradient(180deg, #0f3b3a, #0a2323)',
      ink: '#eafaf5',
      'ink-soft': '#a7d8cf',
      primary: '#0b2a29',
      'primary-light': '#155e57',
      'on-primary': '#eafaf5',
      secondary: '#7ee8d4',
      accent: '#e9c46a',
      'accent-light': '#f7e3a6',
      success: '#6ee7b7',
      danger: '#f87171',
      neutral: '#5f8f86',
      border: 'rgba(233, 196, 106, 0.45)',
      surface: '#123433',
      'surface-raised': 'rgba(17, 52, 50, 0.9)',
      'surface-sunken': '#0c2626',
      cta: '#2a9d8f',
      'on-cta': '#fdf6e3',
      'font-display': "'Uncial Antiqua', 'Cinzel', serif",
      'font-title': "'Uncial Antiqua', Georgia, serif",
      'font-body': "'Lora', Georgia, serif",
      'font-note': "'Lora', Georgia, serif",
      radius: '16px',
      shadow: '0 0 24px rgba(94, 234, 212, 0.15), 0 8px 22px rgba(0, 0, 0, 0.45)',
      texture: SPARKLES,
      'surface-bg': 'linear-gradient(170deg, rgba(21, 94, 87, 0.55), rgba(10, 35, 35, 0.9))',
      'surface-border': '1px solid rgba(233, 196, 106, 0.5)',
      'surface-shadow': '0 0 0 1px rgba(126, 232, 212, 0.15), 0 0 28px rgba(126, 232, 212, 0.12), 0 10px 26px rgba(0, 0, 0, 0.45)',
      'banner-bg': 'linear-gradient(160deg, #155e57, #0b2a29)',
      'banner-ink': '#cdeee7',
      'banner-title': '#f7e3a6',
      'banner-outline': '1px solid rgba(233, 196, 106, 0.6)',
      'heading-ink': '#f7e3a6',
      'title-weight': '400',
      'title-case': 'none',
      'title-spacing': '0.03em',
      'display-weight': '400',
      'display-spacing': '0.02em',
      'display-shadow': '0 0 12px rgba(126, 232, 212, 0.5)',
      'section-rules': 'block',
      'section-ink': '#e9c46a',
      'note-size': '1.05rem',
      'stamp-rotate': '-4deg',
      'stamp-border': '2px solid currentColor',
    },
    sounds: {
      validate: { tones: [[784, 90], [988, 90], [1319, 220]], wave: 'sine' },
      hint: { tones: [[523, 120], [659, 160]], wave: 'sine' },
      treasure: { tones: [[659, 100], [784, 100], [988, 100], [1319, 100], [1568, 400]], wave: 'sine' },
    },
    effects: { validate: 'pulse', treasure: 'confetti', confetti: ['#e9c46a', '#7ee8d4', '#f7e3a6', '#6ee7b7'] },
  },
  {
    id: 'epure',
    name: 'Contemporain',
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
];

/** Skin des chasses qui n'en choisissent pas (et des chasses existantes). */
export const DEFAULT_SKIN = 'aventure';
export const SKIN_IDS = SKINS.map((s) => s.id) as [string, ...string[]];

/** Skins de créateurs publiés (« u12 »), connus une fois chargés (docs/skins.md). */
const CREATOR_SKINS = new Map<string, SkinManifest>();

export function registerSkin(skin: SkinManifest): void {
  CREATOR_SKINS.set(skin.id, skin);
}

export function knownSkin(id: string): boolean {
  return SKINS.some((s) => s.id === id) || CREATOR_SKINS.has(id);
}

/** Identifiant de skin acceptable pour une chasse : intégré, ou de créateur (« u12 »). */
export function skinIdShape(id: string): boolean {
  return (SKIN_IDS as string[]).includes(id) || /^u\d{1,9}$/.test(id);
}

export function skinById(id: string | null | undefined): SkinManifest {
  return SKINS.find((s) => s.id === id) ?? (id ? CREATOR_SKINS.get(id) : undefined) ?? SKINS.find((s) => s.id === DEFAULT_SKIN)!;
}
