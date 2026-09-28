import { Souvenir } from '@shared/models';

/** Carte souvenir au format portrait des réseaux sociaux (4:5). */
export const SOUVENIR_WIDTH = 1080;
export const SOUVENIR_HEIGHT = 1350;

/** Couleurs et polices du skin, lues sur l'élément habillé (variables --th-…). */
export interface SouvenirStyle {
  pageBg: string;
  surface: string;
  ink: string;
  inkSoft: string;
  primary: string;
  accent: string;
  onPrimary: string;
  fontDisplay: string;
  fontBody: string;
}

export function readStyle(el: HTMLElement): SouvenirStyle {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(`--th-${name}`).trim() || fallback;
  return {
    pageBg: v('page-bg', '#f4f1ea'),
    surface: v('surface', '#ffffff'),
    ink: v('ink', '#1c1c1c'),
    inkSoft: v('ink-soft', '#5b5b5b'),
    primary: v('primary', '#13294b'),
    accent: v('accent', '#e4572e'),
    onPrimary: v('on-primary', '#ffffff'),
    fontDisplay: v('font-display', 'serif'),
    fontBody: v('font-body', 'sans-serif'),
  };
}

/** Temps lisible sur une image : « 1 h 24 », « 38 min ». */
export function souvenirTime(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

/**
 * Dessine la carte : en haut la photo de l'équipe (ou la couverture du skin), puis le nom
 * de la chasse, l'équipe, le temps, le rang et la forme du parcours, sans aucun nom de lieu.
 */
export function drawSouvenir(
  ctx: CanvasRenderingContext2D,
  s: Souvenir,
  style: SouvenirStyle,
  picture: CanvasImageSource | null,
  origin: string,
  /** Version anglaise (§ 33) : traduction des libellés, et langue des dates. */
  tr: (fr: string) => string = (fr) => fr,
  locale = 'fr-FR',
): void {
  const W = SOUVENIR_WIDTH;
  const H = SOUVENIR_HEIGHT;
  const pad = 64;
  // Une couleur que le canevas ne sait pas lire (dégradé, var()) laisse la précédente.
  const fill = (color: string, fallback: string) => {
    ctx.fillStyle = fallback;
    ctx.fillStyle = color;
  };
  const stroke = (color: string, fallback: string) => {
    ctx.strokeStyle = fallback;
    ctx.strokeStyle = color;
  };

  fill(style.pageBg, '#f4f1ea');
  ctx.fillRect(0, 0, W, H);

  // Bandeau : photo recadrée, sinon aplat de la couleur du skin.
  const bandH = 520;
  fill(style.primary, '#13294b');
  ctx.fillRect(0, 0, W, bandH);
  if (picture) {
    const { width, height } = sizeOf(picture);
    const scale = Math.max(W / width, bandH / height);
    const w = width * scale;
    const h = height * scale;
    ctx.drawImage(picture, (W - w) / 2, (bandH - h) / 2, w, h);
  }
  const shade = ctx.createLinearGradient(0, bandH - 180, 0, bandH);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, bandH - 180, W, 180);

  // Tampon « Trésor trouvé ! »
  ctx.save();
  ctx.translate(W - pad - 190, bandH - 70);
  ctx.rotate(-0.08);
  fill(style.accent, '#e4572e');
  roundRect(ctx, -190, -44, 380, 88, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 44px ${style.fontDisplay}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tr('Trésor trouvé !'), 0, 2, 350);
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let y = bandH + 96;
  fill(style.primary, '#13294b');
  ctx.font = `700 68px ${style.fontDisplay}`;
  for (const line of wrap(ctx, s.huntName, W - 2 * pad, 2)) {
    ctx.fillText(line, pad, y);
    y += 76;
  }
  fill(style.inkSoft, '#5b5b5b');
  ctx.font = `400 34px ${style.fontBody}`;
  const date = new Date(s.date).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  ctx.fillText(fit(ctx, [s.location, date].filter(Boolean).join(' · '), W - 2 * pad), pad, y);
  y += 70;

  fill(style.ink, '#1c1c1c');
  ctx.font = `700 40px ${style.fontBody}`;
  ctx.fillText(fit(ctx, s.teamName, W - 2 * pad), pad, y);
  y += 48;
  if (s.members.length > 1 || s.members[0] !== s.teamName) {
    fill(style.inkSoft, '#5b5b5b');
    ctx.font = `400 32px ${style.fontBody}`;
    for (const line of wrap(ctx, s.members.join(', '), W - 2 * pad, 2)) {
      ctx.fillText(line, pad, y);
      y += 40;
    }
  }

  // Chiffres, à gauche ; forme du parcours, à droite.
  const top = Math.min(Math.max(y + 110, 860), 960);
  const box = 330;
  const boxX = W - pad - box;
  const stats: [string, string][] = [[souvenirTime(s.time), tr(s.penalty ? `dont ${Math.round(s.penalty)} min de pénalités` : 'temps de parcours')]];
  if (s.rank !== null) {
    const rank = locale.startsWith('fr') ? `${s.rank}${s.rank === 1 ? 'ʳᵉ' : 'ᵉ'}` : `#${s.rank}`;
    stats.push([`${rank} / ${s.ranked}`, tr(s.scope === 'catalog' ? 'parmi tous les joueurs' : s.provisional ? 'place provisoire' : 'au classement')]);
  }
  stats.push([`${s.found}/${s.totalSteps}`, `${tr('lieux trouvés')}${s.hints ? ` · ${tr(`${s.hints} joker${s.hints > 1 ? 's' : ''}`)}` : ''}`]);
  let sy = top;
  for (const [big, small] of stats) {
    fill(style.primary, '#13294b');
    ctx.font = `700 64px ${style.fontDisplay}`;
    ctx.fillText(fit(ctx, big, boxX - pad - 30), pad, sy);
    fill(style.inkSoft, '#5b5b5b');
    ctx.font = `400 28px ${style.fontBody}`;
    ctx.fillText(fit(ctx, small, boxX - pad - 30), pad, sy + 38);
    sy += 118;
  }

  if (s.trail.length > 1) {
    const inner = box - 60;
    const pts = s.trail.map(([x, yy]) => [boxX + 30 + x * inner, top - 50 + 30 + yy * inner] as const);
    fill(style.surface, '#ffffff');
    roundRect(ctx, boxX, top - 50, box, box, 24);
    ctx.fill();
    stroke(style.accent, '#e4572e');
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([14, 14]);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
    ctx.setLineDash([]);
    fill(style.primary, '#13294b');
    for (const [px, py] of pts.slice(1, -1)) {
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    const [sx, sy0] = pts[0]!;
    ctx.beginPath();
    ctx.arc(sx, sy0, 14, 0, Math.PI * 2);
    ctx.fill();
    // Le trésor : une croix.
    const [ex, ey] = pts.at(-1)!;
    stroke(style.accent, '#e4572e');
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(ex - 16, ey - 16);
    ctx.lineTo(ex + 16, ey + 16);
    ctx.moveTo(ex + 16, ey - 16);
    ctx.lineTo(ex - 16, ey + 16);
    ctx.stroke();
  }

  // Pied : l'application.
  fill(style.primary, '#13294b');
  ctx.fillRect(0, H - 90, W, 90);
  fill(style.onPrimary, '#ffffff');
  ctx.font = `700 34px ${style.fontBody}`;
  ctx.fillText('Treasure Hunters', pad, H - 34);
  ctx.textAlign = 'right';
  ctx.font = `400 28px ${style.fontBody}`;
  ctx.fillText(origin.replace(/^https?:\/\//, ''), W - pad, H - 36);
  ctx.textAlign = 'left';
}

function sizeOf(img: CanvasImageSource): { width: number; height: number } {
  if (img instanceof HTMLImageElement) return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  if (img instanceof HTMLVideoElement) return { width: img.videoWidth, height: img.videoHeight };
  const any = img as { width: number | SVGAnimatedLength; height: number | SVGAnimatedLength };
  const n = (v: number | SVGAnimatedLength) => (typeof v === 'number' ? v : v.baseVal.value);
  return { width: n(any.width), height: n(any.height) };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Coupe le texte en lignes (au plus `max`, la dernière tronquée d'un « … »). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines.map((l) => fit(ctx, l, width));
  return [...lines.slice(0, max - 1), fit(ctx, lines.slice(max - 1).join(' '), width)];
}

/** Tronque d'un « … » ce qui dépasse la largeur. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
