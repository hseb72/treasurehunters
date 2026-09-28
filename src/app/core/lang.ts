/**
 * Langue de l'interface (§ 33) : français par défaut pour un téléphone réglé en français,
 * anglais sinon (les touristes) ; le choix du joueur est retenu sur son téléphone.
 */
export type Lang = 'fr' | 'en';

const KEY = 'th-lang';

export function currentLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    // stockage indisponible
  }
  const nav = typeof navigator === 'undefined' ? 'fr' : (navigator.language || 'fr').toLowerCase();
  return nav.startsWith('fr') ? 'fr' : 'en';
}

/** Change de langue : la page se recharge, dates et textes suivent. */
export function switchLang(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // stockage indisponible : le choix vaut pour cette visite
  }
  location.reload();
}
