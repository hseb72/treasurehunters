import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { GENERATION_LIMITS, GENERATION_OFFERS } from '@shared/generation-access';
import { priceLabel } from '@shared/store';
import { ASSIST_LIMITS } from '@shared/assist';

/**
 * Conditions d'utilisation (§ 21, § 25) : ce que couvrent la chasse sur mesure, les forfaits,
 * les crédits et l'assistant de rédaction, et les limites d'usage qui protègent le service. Les
 * chiffres viennent des mêmes constantes que le code (shared/generation-access.ts, shared/assist.ts).
 */
@Component({
  selector: 'th-terms',
  imports: [MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="page stack terms">
      <header>
        <h1>Conditions d'utilisation</h1>
        <p class="small muted">Version de travail, à faire valider avant l'ouverture du paiement.</p>
      </header>

      <section class="surface" id="Secret Track-sur-mesure">
        <h2>Secret Track sur mesure (génération par l'IA)</h2>
        <p>
          Le maître du jeu invente une Secret Track à partir de lieux réels (OpenStreetMap) et d'un modèle d'intelligence artificielle, dont chaque
          utilisation a un coût. Elle est ouverte :
        </p>
        <ul>
          <li>à tous, gratuitement, tant que le paiement n'est pas ouvert ;</li>
          <li>puis à l'unité : {{ single }} la Secret Track ;</li>
          <li>avec un forfait : {{ month }} pour 30 jours, {{ year }} pour un an, sans reconduction automatique ;</li>
          <li>
            aux créateurs dont les Secret Tracks partagées au catalogue sont jouées jusqu'au bout par d'autres : {{ limits.creatorBonusPerHunt }} crédits par
            Secret Track, jusqu'à {{ limits.creatorBonusMax }} crédits ;
          </li>
          <li>aux membres fondateurs.</li>
        </ul>
        <h3>Limites d'usage</h3>
        <p>Pour que le service reste soutenable, quelle que soit la formule :</p>
        <ul>
          <li><strong>{{ limits.daily }} Secret Tracks réussies par 24 heures</strong> et par compte ;</li>
          <li>
            <strong>{{ limits.daily * limits.attemptsFactor }} essais par 24 heures</strong>, échecs compris : au-delà, le service suppose un problème
            et demande d'attendre ;
          </li>
          <li>avec un forfait, <strong>{{ limits.passMonthly }} Secret Tracks réussies par 30 jours glissants</strong> ; au-delà, un crédit à l'unité permet d'en inventer d'autres.</li>
        </ul>
        <p>
          Une Secret Track qui n'a pas pu être inventée (lieu introuvable, service indisponible) <strong>n'est pas décomptée</strong> : crédit et
          forfait restent intacts. Un crédit se consomme à la Secret Track réussie et n'expire pas. Un compte ne se partage pas ; l'utilisation
          automatisée ou la revente des Secret Tracks inventées peut entraîner la suspension de l'accès.
        </p>
      </section>

      <section class="surface" id="assistant">
        <h2>Assistant de rédaction</h2>
        <p>
          Dans l'éditeur d'étapes, l'IA propose une énigme reformulée, plus facile ou plus difficile, trois jokers, ou une relecture. Ses
          propositions ne remplacent jamais votre texte d'office : vous choisissez de les garder ou non. Chaque proposition reçue compte une
          suggestion :
        </p>
        <ul>
          <li><strong>{{ assist.monthly }} suggestions par 30 jours glissants</strong>, offertes à tous les organisateurs ;</li>
          <li><strong>{{ assist.passMonthly }} par 30 jours</strong> avec un forfait de Secret Tracks sur mesure en cours, et pour les membres fondateurs ;</li>
          <li>dans tous les cas, <strong>{{ assist.daily }} suggestions par 24 heures</strong> au plus.</li>
        </ul>
        <p>
          Chaque suggestion redevient disponible 30 jours après avoir servi. Le décompte (utilisées, restantes, date du prochain retour) se
          consulte à tout moment dans l'éditeur et dans <a routerLink="/me">votre profil</a>. Une demande qui échoue <strong>n'est pas
          décomptée</strong>.
        </p>
      </section>

      <section class="surface">
        <h2>Achats et paiement</h2>
        <p>
          Les paiements passent par Stripe ; SecretTracks ne voit ni ne conserve vos coordonnées bancaires. Les univers, outils, packs et
          Secret Tracks du catalogue achetés le sont pour votre compte, sans limite de durée. Les Secret Tracks du catalogue et les créations de la
          communauté sont vendues par leurs auteurs, qui en reçoivent le prix moins la commission de la plateforme.
        </p>
      </section>

      <section class="surface">
        <h2>Créateurs et auteurs</h2>
        <p>
          Les créations proposées (univers, packs d'énigmes) sont relues avant publication. Leurs auteurs garantissent détenir les droits sur
          les images, polices et sons utilisés. Pour être payés, ils s'inscrivent chez Stripe ; ils restent responsables de déclarer leurs revenus.
          Voir aussi <a routerLink="/creator">l'atelier créateur</a>.
        </p>
      </section>
    </article>
  `,
  styles: `
    .terms { max-width: 760px; margin: 0 auto; }
    h1 { margin: 0; }
    h2 { margin-top: 0; }
    section p, section li { line-height: 1.55; }
  `,
})
export class TermsPage {
  protected readonly limits = GENERATION_LIMITS;
  protected readonly assist = ASSIST_LIMITS;
  private readonly label = (id: string) => priceLabel({ price: GENERATION_OFFERS.find((o) => o.id === id)!.price, included: false });
  protected readonly single = this.label('gen:single');
  protected readonly month = this.label('gen:month');
  protected readonly year = this.label('gen:year');
}
