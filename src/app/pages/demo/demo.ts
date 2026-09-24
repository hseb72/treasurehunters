import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { HuntApi } from '../../core/api';
import { DEMO_TOKENS } from '@shared/fixtures';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';

type Persona = 'seb' | 'camille' | 'visitor';

interface Scenario {
  persona: Persona;
  url: string;
  title: string;
  text: string;
}

const EMAILS: Record<Exclude<Persona, 'visitor'>, string> = { seb: 'seb@example.com', camille: 'camille@example.com' };

/** Guide des maquettes : raccourcis vers chaque écran et chaque état, avec le bon personnage. */
@Component({
  selector: 'th-demo',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './demo.html',
  styleUrl: './demo.scss',
})
export class DemoPage {
  private readonly api = inject(HuntApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);

  protected readonly personas: Record<Persona, string> = { seb: 'seb (joueur)', camille: 'Camille (organisatrice)', visitor: 'Visiteur' };

  protected readonly groups: { title: string; icon: string; scenarios: Scenario[] }[] = [
    {
      title: 'Parcours joueur',
      icon: 'hiking',
      scenarios: [
        { persona: 'seb', url: '/', title: 'Carnet de bord', text: 'Expédition en cours, prochaines expéditions, archives.' },
        { persona: 'seb', url: '/play/1', title: 'Carnet de route', text: 'Chrono, piste, énigme en cours, joker sous scellé, journal.' },
        { persona: 'seb', url: '/hunts/2', title: 'Inscrit, avant le départ', text: 'Équipe, code à partager, compte à rebours.' },
        { persona: 'seb', url: '/hunts/5', title: 'S’inscrire en solo', text: 'Chasse publique ouverte aux inscriptions.' },
        { persona: 'seb', url: '/hunts/3/results', title: 'Podium et classement', text: 'Chasse close, seb termine 2ᵉ.' },
        { persona: 'seb', url: '/scan', title: 'Scanner', text: 'Caméra (Chrome Android) ou saisie manuelle du code.' },
      ],
    },
    {
      title: 'Scanner un QR code',
      icon: 'qr_code_scanner',
      scenarios: [
        { persona: 'seb', url: `/q/${DEMO_TOKENS.nefles[3]}`, title: 'Étape validée', text: 'Étape 3 : message d’arrivée puis énigme suivante (une seule fois !).' },
        { persona: 'seb', url: `/q/${DEMO_TOKENS.nefles[2]}`, title: 'Étape déjà validée', text: 'Rappel de l’énigme en cours.' },
        { persona: 'seb', url: `/q/${DEMO_TOKENS.nefles[5]}`, title: 'Étape sautée', text: 'L’arrivée scannée trop tôt : « Fausse piste ! »' },
        { persona: 'seb', url: `/q/${DEMO_TOKENS.lez[1]}`, title: 'Pas encore commencée', text: 'Compte à rebours jusqu’au départ.' },
        { persona: 'seb', url: `/q/${DEMO_TOKENS.palavas[2]}`, title: 'Chasse terminée', text: 'Podium affiché à la place de l’indice.' },
        { persona: 'visitor', url: `/q/${DEMO_TOKENS.nefles[1]}`, title: 'Non connecté', text: 'Invitation à se connecter, retour automatique ensuite.' },
        { persona: 'camille', url: `/q/${DEMO_TOKENS.nefles[1]}`, title: 'Mode organisateur', text: 'Test du QR sur place sans fausser la course.' },
        { persona: 'seb', url: '/q/inconnu', title: 'QR inconnu', text: '« Parchemin illisible ».' },
      ],
    },
    {
      title: 'Parcours organisateur',
      icon: 'map',
      scenarios: [
        { persona: 'camille', url: '/organize', title: 'Mes expéditions', text: 'Toutes les chasses de Camille.' },
        { persona: 'camille', url: '/organize/1/live', title: 'Pilotage en direct', text: 'Progression des équipes, validation manuelle, clôture.' },
        { persona: 'camille', url: '/organize/1/steps', title: 'Parcours', text: 'Étapes, énigmes et jokers (verrouillé pendant la course).' },
        { persona: 'camille', url: '/organize/1/qrcodes', title: 'Planche de QR codes', text: 'Une page imprimable par étape.' },
        { persona: 'camille', url: '/organize/2/teams', title: 'Ordre de passage', text: 'Inscrits ; en départ échelonné, tirage au sort et glisser-déposer.' },
        { persona: 'camille', url: '/organize/2/info', title: 'Donner le départ', text: 'Rallye du Lez publié : bouton « Top départ ! ».' },
        { persona: 'seb', url: '/organize/4/steps', title: 'Préparer un brouillon', text: 'Chasse de seb : réordonner, ajouter, publier.' },
        { persona: 'seb', url: '/organize/new', title: 'Nouvelle chasse', text: 'Formulaire de création.' },
      ],
    },
  ];

  protected go(s: Scenario): void {
    if (s.persona === 'visitor') {
      this.session.set(null);
      this.router.navigateByUrl(s.url);
      return;
    }
    if (this.session.user()?.email === EMAILS[s.persona]) {
      this.router.navigateByUrl(s.url);
      return;
    }
    this.api.login(EMAILS[s.persona], 'demo').subscribe({
      next: (auth) => {
        this.session.set(auth);
        this.router.navigateByUrl(s.url);
      },
      error: (e) => this.notify.error(e),
    });
  }

  protected reset(): void {
    location.reload();
  }
}
