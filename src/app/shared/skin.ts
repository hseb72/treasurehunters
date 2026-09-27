import { Directive, ElementRef, inject, Injectable, input, effect, Renderer2, RendererStyleFlags2, signal } from '@angular/core';
import { SkinManifest, SkinSound, SkinSoundEvent, safeSkinUrl, skinById, skinStyle } from '@shared/skins';

/**
 * Habille un conteneur aux couleurs du skin d'une chasse (docs/skins.md) : jetons de
 * style en variables CSS, schéma clair ou sombre, polices du skin. Seul ce conteneur
 * change : la barre de l'application et les fenêtres restent neutres.
 */
@Directive({
  selector: '[thSkin]',
  host: { class: 'skin' },
})
export class SkinDirective {
  /** Identifiant du skin (`hunt.skin`) ou manifeste complet (aperçu). */
  readonly thSkin = input.required<string | SkinManifest | null | undefined>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);
  private applied: string[] = [];

  constructor() {
    effect(() => {
      const value = this.thSkin();
      // Tant que la chasse n'est pas chargée : l'habillage neutre de l'application.
      const skin = typeof value === 'object' && value ? value : value ? skinById(value) : NEUTRAL;
      const host = this.el.nativeElement as HTMLElement;
      for (const name of this.applied) this.renderer.removeStyle(host, name, RendererStyleFlags2.DashCase);
      const style = skinStyle(skin);
      for (const [name, v] of Object.entries(style)) this.renderer.setStyle(host, name, v, RendererStyleFlags2.DashCase);
      this.applied = Object.keys(style);
      this.renderer.setStyle(host, 'color-scheme', skin.scheme);
      this.renderer.setAttribute(host, 'data-skin', skin.id);
      loadFonts(skin);
    });
  }
}

const NEUTRAL: SkinManifest = { id: 'neutre', name: '', description: '', author: '', price: 0, scheme: 'light', tokens: {}, cover: '' };

const loadedFonts = new Set<string>();

/** Polices d'un skin tiers : chargées à la demande (celles des skins intégrés sont livrées). */
function loadFonts(skin: SkinManifest): void {
  if (typeof FontFace === 'undefined' || !skin.fonts) return;
  for (const f of skin.fonts) {
    const key = `${f.family}|${f.url}|${f.weight ?? ''}|${f.style ?? ''}`;
    if (loadedFonts.has(key) || !safeSkinUrl(f.url) || !/^[\w -]{1,60}$/.test(f.family)) continue;
    loadedFonts.add(key);
    const face = new FontFace(f.family, `url(${f.url})`, { weight: f.weight ?? '400', style: f.style ?? 'normal', display: 'swap' });
    face.load().then((loaded) => document.fonts.add(loaded)).catch(() => loadedFonts.delete(key));
  }
}

const MUTE_KEY = 'th-sound-muted';

/**
 * Sons et animations du skin : un son court à la validation d'une étape, au joker et au
 * trésor ; un tampon ou une pulsation ; des confettis à l'arrivée. Tout reste discret :
 * rien si l'utilisateur a coupé le son, ni animation s'il préfère moins de mouvement.
 */
@Injectable({ providedIn: 'root' })
export class SkinEffects {
  readonly muted = signal(readMuted());
  private audio: AudioContext | null = null;

  toggleSound(): void {
    this.muted.update((m) => !m);
    try {
      localStorage.setItem(MUTE_KEY, this.muted() ? '1' : '0');
    } catch {
      // stockage indisponible (navigation privée) : réglage pour cette visite seulement
    }
  }

  /** Étape validée : son et animation de l'élément (le tampon, la carte de l'étape…). */
  validated(skinId: string | null | undefined, target?: Element | null): void {
    const skin = skinById(skinId);
    this.play(skin.sounds?.validate);
    const kind = skin.effects?.validate ?? 'none';
    if (target && kind !== 'none' && !reducedMotion()) {
      target.classList.remove('fx-stamp', 'fx-pulse');
      void (target as HTMLElement).offsetWidth; // relance l'animation
      target.classList.add(kind === 'stamp' ? 'fx-stamp' : 'fx-pulse');
    }
  }

  /** Classe d'animation à poser sur le tampon d'une étape validée. */
  validateClass(skinId: string | null | undefined): string {
    const kind = skinById(skinId).effects?.validate ?? 'none';
    return kind === 'none' || reducedMotion() ? '' : kind === 'stamp' ? 'fx-stamp' : 'fx-pulse';
  }

  hint(skinId: string | null | undefined): void {
    this.play(skinById(skinId).sounds?.hint);
  }

  /** Trésor trouvé : fanfare et confettis. */
  treasure(skinId: string | null | undefined): void {
    const skin = skinById(skinId);
    this.play(skin.sounds?.treasure);
    if (skin.effects?.treasure === 'confetti' && !reducedMotion()) confetti(skin.effects.confetti ?? ['#f2a93b', '#1d4ed8']);
  }

  private play(sound: SkinSound | undefined): void {
    if (!sound || this.muted() || typeof window === 'undefined') return;
    if ('url' in sound) {
      if (safeSkinUrl(sound.url)) new Audio(sound.url).play().catch(() => undefined);
      return;
    }
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      let t = ctx.currentTime + 0.02;
      for (const [freq, ms] of sound.tones.slice(0, 12)) {
        const dur = Math.min(Math.max(ms, 20), 800) / 1000;
        if (freq > 0) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = sound.wave ?? 'sine';
          osc.frequency.value = Math.min(Math.max(freq, 60), 4000);
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + dur + 0.02);
        }
        t += dur;
      }
    } catch {
      // pas de son disponible : la partie continue
    }
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Confettis sur un calque éphémère, sans bibliothèque. */
function confetti(colors: string[]): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');
  if (!g) return canvas.remove();
  g.scale(dpr, dpr);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const parts = Array.from({ length: 140 }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.4,
    y: h * 0.35,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 11 - 4,
    size: 5 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (now: number) => {
    const elapsed = now - start;
    g.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      g.save();
      g.globalAlpha = Math.max(0, 1 - elapsed / 3200);
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      g.restore();
    }
    if (elapsed < 3200) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
