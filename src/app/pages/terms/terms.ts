import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { GENERATION_LIMITS, GENERATION_OFFERS } from '@shared/generation-access';
import { priceLabel } from '@shared/store';

/**
 * Conditions d'utilisation (§ 21) : ce que couvrent la chasse sur mesure, les forfaits et les
 * crédits, et les limites d'usage qui protègent le service. Les chiffres viennent des mêmes
 * constantes que le code (shared/generation-access.ts).
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

      <section class="surface" id="chasse-sur-mesure">
        <h2>Chasse sur mesure (génération par l'IA)</h2>
        <p>
          Le maître du jeu invente une chasse à partir de lieux réels (OpenStreetMap) et d'un modèle d'intelligence artificielle, dont chaque
          utilisation a un coût. Elle est ouverte :
        </p>
        <ul>
          <li>à tous, gratuitement, tant que le paiement n'est pas ouvert ;</li>
          <li>puis à l'unité : {{ single }} la chasse ;</li>
          <li>avec un forfait : {{ month }} pour 30 jours, {{ year }} pour un an, sans reconduction automatique ;</li>
          <li>
            aux créateurs dont les chasses partagées au catalogue sont jouées jusqu'au bout par d'autres : {{ limits.creatorBonusPerHunt }} crédits par
            chasse, jusqu'à {{ limits.creatorBonusMax }} crédits ;
          </li>
          <li>aux membres fondateurs.</li>
        </ul>
        <h3>Limites d'usage</h3>
        <p>Pour que le service reste soutenable, quelle que soit la formule :</p>
        <ul>
          <li><strong>{{ limits.daily }} chasses réussies par 24 heures</strong> et par compte ;</li>
          <li>
            <strong>{{ limits.daily * limits.attemptsFactor }} essais par 24 heures</strong>, échecs compris : au-delà, le service suppose un problème
            et demande d'attendre ;
          </li>
          <li>avec un forfait, <strong>{{ limits.passMonthly }} chasses réussies par 30 jours glissants</strong> ; au-delà, un crédit à l'unité permet d'en inventer d'autres.</li>
        </ul>
        <p>
          Une chasse qui n'a pas pu être inventée (lieu introuvable, service indisponible) <strong>n'est pas décomptée</strong> : crédit et
          forfait restent intacts. Un crédit se consomme à la chasse réussie et n'expire pas. Un compte ne se partage pas ; l'utilisation
          automatisée ou la revente des chasses inventées peut entraîner la suspension de l'accès.
        </p>
      </section>

      <section class="surface">
        <h2>Achats et paiement</h2>
        <p>
          Les paiements passent par Stripe ; Treasure Hunters ne voit ni ne conserve vos coordonnées bancaires. Les univers, outils, packs et
          chasses du catalogue achetés le sont pour votre compte, sans limite de durée. Les chasses du catalogue et les créations de la
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
  private readonly label = (id: string) => priceLabel({ price: GENERATION_OFFERS.find((o) => o.id === id)!.price, included: false });
  protected readonly single = this.label('gen:single');
  protected readonly month = this.label('gen:month');
  protected readonly year = this.label('gen:year');
}
