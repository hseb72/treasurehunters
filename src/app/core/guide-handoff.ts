import { inject, Injectable } from '@angular/core';
import { GuideInterest } from '@shared/guide';
import { Hunt } from '@shared/models';
import { HuntApi } from './api';

const KEY = 'th.guide.interests';
/** Au-delà, le joueur est passé à autre chose. */
const TTL_MS = 3 * 3600_000;

interface Pending {
  interests: GuideInterest[];
  /** Secret Track du catalogue choisie ; null = parcours sur mesure à venir. */
  catalogId: number | null;
  at: number;
}

/**
 * Passage des centres d'intérêt du guide (§ 46) à la partie : le guide les garde ici le temps
 * que le joueur lance la Secret Track choisie (ou que le parcours sur mesure soit prêt), puis
 * le carnet de route les enregistre pour son équipe.
 */
@Injectable({ providedIn: 'root' })
export class GuideHandoff {
  private readonly api = inject(HuntApi);

  keep(interests: GuideInterest[], catalogId: number | null): void {
    try {
      if (!interests.length) sessionStorage.removeItem(KEY);
      else sessionStorage.setItem(KEY, JSON.stringify({ interests, catalogId, at: Date.now() } satisfies Pending));
    } catch {
      // Stockage indisponible (navigation privée) : les centres d'intérêt sont perdus, la partie non.
    }
  }

  /** À l'ouverture d'une partie : enregistre les centres d'intérêt s'ils la concernent. */
  apply(hunt: Hunt, onSaved: () => void = () => {}): void {
    let pending: Pending | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Pending | null;
    } catch {
      return;
    }
    if (!pending) return;
    if (Date.now() - pending.at > TTL_MS) {
      this.keep([], null);
      return;
    }
    const matches = pending.catalogId !== null ? hunt.catalogId === pending.catalogId : hunt.generated;
    if (!matches) return;
    this.keep([], null);
    this.api.setInterests(hunt.id, pending.interests).subscribe({ next: onSaved, error: () => {} });
  }
}
