import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { QRCodeComponent } from 'angularx-qrcode';
import { Hunt, Team } from '@shared/models';
import { Notify } from '../core/notify';

type Kind = 'teammate' | 'rival';

interface Invitation {
  code: string;
  url: string;
  subject: string;
  text: string;
}

/**
 * Inviter d'autres joueurs : un coéquipier rejoint l'équipe (code d'équipe), un adversaire
 * inscrit la sienne (code de la chasse). Chaque invitation se partage par QR code, par le
 * partage du téléphone (SMS, messageries…), par e-mail ou en copiant le lien.
 */
@Component({
  selector: 'th-invite-panel',
  imports: [MatButtonModule, MatIconModule, QRCodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invite-panel.html',
  styleUrl: './invite-panel.scss',
})
export class InvitePanel {
  private readonly notify = inject(Notify);

  readonly hunt = input.required<Hunt>();
  readonly team = input.required<Team>();

  /** Il reste de la place dans l'équipe, et elle n'a pas fini. */
  protected readonly teammateOpen = computed(() => {
    const team = this.team();
    return !team.solo && !team.finished && team.members.length < this.hunt().teamMax;
  });

  /** Les inscriptions sont ouvertes (et, en équipes, un adversaire peut fonder la sienne). */
  protected readonly rivalOpen = computed(() => {
    const h = this.hunt();
    return h.status === 'published' || (h.surprise && h.selfPaced && h.status === 'running');
  });

  protected readonly kind = linkedSignal<Kind>(() => (this.teammateOpen() ? 'teammate' : 'rival'));

  protected readonly invitation = computed((): Invitation => {
    const h = this.hunt();
    const team = this.team();
    const where = h.location ? ` autour de ${h.location}` : '';
    if (this.kind() === 'teammate') {
      const url = `${location.origin}/hunts/${h.id}?code=${team.joinCode}`;
      return {
        code: team.joinCode,
        url,
        subject: `Rejoins mon équipe : « ${h.name} »`,
        text:
          `Je pars à la chasse au trésor « ${h.name} »${where}. Rejoins mon équipe « ${team.name} » sur Treasure Hunters : ${url}\n` +
          `Ou saisis le code d'équipe ${team.joinCode} dans l'application.`,
      };
    }
    const url = `${location.origin}/hunts/${h.id}?code=${h.joinCode}`;
    const start =
      h.surprise && h.selfPaced
        ? ' Chacun lance son chrono quand il veut : le meilleur temps l’emporte.'
        : h.surprise
          ? ` ${h.hostNickname ?? 'Je'} donnera le départ à toutes les équipes en même temps.`
          : '';
    return {
      code: h.joinCode,
      url,
      subject: `Défi : « ${h.name} »`,
      text:
        `Je te défie sur la chasse au trésor « ${h.name} »${where}.${start} Inscris ton équipe sur Treasure Hunters : ${url}\n` +
        `Ou saisis le code d'expédition ${h.joinCode} dans l'application.`,
    };
  });

  protected readonly mailto = computed(() => {
    const i = this.invitation();
    return `mailto:?subject=${encodeURIComponent(i.subject)}&body=${encodeURIComponent(i.text)}`;
  });

  protected readonly canShare = typeof navigator !== 'undefined' && !!navigator.share;

  protected share(): void {
    const i = this.invitation();
    navigator.share({ title: i.subject, text: i.text }).catch(() => undefined);
  }

  protected copy(): void {
    const url = this.invitation().url;
    navigator.clipboard?.writeText(url).then(
      () => this.notify.info('Lien d’invitation copié.'),
      () => this.notify.info(url),
    );
  }
}
