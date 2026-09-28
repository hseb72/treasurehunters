import { inject, Injectable, signal } from '@angular/core';
import { translateUi } from '../i18n/en';
import { HuntApi } from './api';
import { currentLang, Lang } from './lang';

/** Attributs traduits en plus des textes. */
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
/** Là où l'on ne traduit jamais : saisies, icônes, code, et ce qui est marqué translate="no". */
const SKIP = 'input, textarea, script, style, mat-icon, .material-symbols-outlined, code, [translate="no"], [contenteditable]';

/**
 * Version anglaise (§ 33). Plutôt que de réécrire chaque écran, les textes affichés sont
 * traduits à la volée : un dictionnaire pour l'interface (src/app/i18n/en.ts, avec des modèles
 * pour les textes à nombres), et les traductions du contenu des chasses (énigmes, jokers,
 * fiches) demandées au serveur. Un texte inconnu reste en français.
 */
@Injectable({ providedIn: 'root' })
export class DomTranslator {
  private readonly api = inject(HuntApi);
  readonly lang: Lang = currentLang();
  /** Traductions du contenu des chasses, reçues du serveur. */
  private readonly content = new Map<string, string>();
  /** Ce que chaque nœud affichait en français, et ce qu'on y a mis. */
  private readonly nodes = new WeakMap<Node, { src: string; out: string }>();
  private readonly attrs = new WeakMap<Element, Map<string, { src: string; out: string }>>();
  private observer: MutationObserver | null = null;
  /** Textes sans traduction, relevés en développement pour compléter le dictionnaire. */
  readonly missing = signal(new Set<string>());

  get english(): boolean {
    return this.lang === 'en';
  }

  /** Démarre la traduction de la page (anglais seulement). */
  start(root: HTMLElement = document.body): void {
    if (!this.english || this.observer) return;
    document.documentElement.lang = 'en';
    // Relevé des textes sans traduction (outil de mise au point du dictionnaire).
    (window as unknown as { __thMissing: () => string[] }).__thMissing = () => [...this.missing()];
    this.walk(root);
    this.observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') this.text(r.target);
        else if (r.type === 'attributes') this.attr(r.target as Element, r.attributeName!);
        else r.addedNodes.forEach((n) => this.walk(n));
      }
    });
    this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  /** Traduction d'un texte de l'interface (canevas, messages construits en code). */
  t(fr: string): string {
    return this.english ? (this.lookup(fr) ?? fr) : fr;
  }

  /** Demande au serveur la traduction du contenu visible d'une partie ou de fiches du catalogue. */
  requestContent(req: { hunt?: number; catalog?: number[]; info?: number[] }): void {
    if (!this.english || (!req.hunt && !req.catalog?.length && !req.info?.length)) return;
    this.api.translate({ lang: 'en', ...req }).subscribe({
      next: (map) => {
        let added = false;
        for (const [fr, en] of Object.entries(map)) {
          if (this.content.get(fr) !== en) {
            this.content.set(fr, en);
            added = true;
          }
        }
        if (added) this.walk(document.body);
      },
      error: () => undefined, // sans traduction, le contenu reste en français
    });
  }

  private walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      this.text(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.matches(SKIP)) return;
    for (const a of ATTRS) if (el.hasAttribute(a)) this.attr(el, a);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) this.text(n);
      else for (const a of ATTRS) if ((n as Element).hasAttribute(a)) this.attr(n as Element, a);
    }
  }

  private text(node: Node): void {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const data = node.nodeValue ?? '';
    const known = this.nodes.get(node);
    // Texte changé par Angular (ou jamais vu) : c'est une nouvelle source française.
    const src = known && data === known.out ? known.src : data;
    const out = this.translateRaw(src);
    this.nodes.set(node, { src, out });
    if (out !== data) node.nodeValue = out;
  }

  private attr(el: Element, name: string): void {
    if (el.closest(SKIP) && !(el.matches('input, textarea') && name === 'placeholder')) return;
    const value = el.getAttribute(name) ?? '';
    const map = this.attrs.get(el) ?? new Map<string, { src: string; out: string }>();
    this.attrs.set(el, map);
    const known = map.get(name);
    const src = known && value === known.out ? known.src : value;
    const out = this.translateRaw(src);
    map.set(name, { src, out });
    if (out !== value) el.setAttribute(name, out);
  }

  /** Garde les espaces autour du texte, traduit le cœur. */
  private translateRaw(raw: string): string {
    const core = raw.trim();
    if (!core || !/[A-Za-zÀ-ÿ]/.test(core)) return raw;
    const tr = this.lookup(core.replace(/\s+/g, ' '));
    if (tr === null) {
      if (core.length < 400 && this.missing().size < 2000) this.missing.update((s) => (s.has(core) ? s : new Set(s).add(core)));
      return raw;
    }
    // Typographie anglaise : pas d'espace avant « : » ni « ; » (le français en met une).
    const start = raw.indexOf(core);
    return (/^[:;]/.test(tr) ? raw.slice(0, start).replace(/[ \u00a0\u202f]+$/, '') : raw.slice(0, start)) + tr + raw.slice(start + core.length);
  }

  private lookup(text: string): string | null {
    const content = this.content.get(text);
    if (content !== undefined) return content;
    const joker = /^Joker (\d+) : ([\s\S]+)$/.exec(text);
    if (joker && this.content.has(joker[2]!)) return `Hint ${joker[1]}: ${this.content.get(joker[2]!)}`;
    return translateUi(text);
  }

}
