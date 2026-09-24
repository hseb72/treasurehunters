import { ChangeDetectionStrategy, Component, computed, effect, inject, input, numberAttribute } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, switchMap } from 'rxjs';
import { HuntAction, HuntApi } from '../../core/api';
import { HuntStatus } from '../../core/models';
import { Notify } from '../../core/notify';
import { Confirm, ConfirmData } from '../../shared/confirm-dialog';
import { StatusBadge } from '../../shared/status-badge';
import { WorkspaceState } from './workspace-state';

const LIFECYCLE: { status: HuntStatus; label: string }[] = [
  { status: 'draft', label: 'Brouillon' },
  { status: 'published', label: 'Publiée' },
  { status: 'running', label: 'En cours' },
  { status: 'closed', label: 'Terminée' },
];

const ACTIONS: Record<HuntAction, ConfirmData & { icon: string }> = {
  publish: {
    icon: 'campaign',
    title: 'Publier l’expédition ?',
    message: 'Les joueurs pourront la découvrir et s’inscrire. Vérifiez vos étapes et imprimez vos QR codes.',
    confirm: 'Publier',
  },
  unpublish: { icon: 'undo', title: 'Repasser en brouillon ?', message: 'L’expédition ne sera plus visible.', confirm: 'Dépublier' },
  start: {
    icon: 'flag',
    title: 'Donner le départ ?',
    message: 'Les QR codes deviennent actifs et les équipes reçoivent leur première énigme à leur heure de départ.',
    confirm: 'Top départ !',
  },
  close: {
    icon: 'sports_score',
    title: 'Clôturer l’expédition ?',
    message: 'Les QR codes seront désactivés et le podium publié. Les équipes non arrivées ne seront pas classées.',
    confirm: 'Clôturer',
    danger: true,
  },
  cancel: { icon: 'block', title: 'Annuler l’expédition ?', message: 'Cette action est définitive.', confirm: 'Annuler l’expédition', danger: true },
};

@Component({
  selector: 'th-workspace',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTabsModule, RouterLink, RouterLinkActive, RouterOutlet, StatusBadge],
  providers: [WorkspaceState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace.html',
  styleUrl: './workspace.scss',
})
export class WorkspacePage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  protected readonly state = inject(WorkspaceState);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly lifecycle = LIFECYCLE;
  protected readonly actions = ACTIONS;

  protected readonly tabs = [
    { path: 'info', label: 'Infos', icon: 'edit_note' },
    { path: 'steps', label: 'Étapes', icon: 'route' },
    { path: 'teams', label: 'Équipes', icon: 'groups' },
    { path: 'qrcodes', label: 'QR codes', icon: 'qr_code_2' },
    { path: 'live', label: 'Direct', icon: 'radar' },
  ];

  protected readonly stage = computed(() => {
    const status = this.state.hunt.value()?.status;
    return LIFECYCLE.findIndex((l) => l.status === status);
  });

  /** Action principale proposée selon le statut. */
  protected readonly nextAction = computed<HuntAction | null>(() => {
    switch (this.state.hunt.value()?.status) {
      case 'draft':
        return 'publish';
      case 'published':
        return 'start';
      case 'running':
        return 'close';
      default:
        return null;
    }
  });

  constructor() {
    effect(() => this.state.huntId.set(this.id()));
  }

  protected run(action: HuntAction): void {
    this.confirm
      .ask(ACTIONS[action])
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.huntAction(this.id(), action)),
      )
      .subscribe({
        next: (hunt) => {
          this.state.hunt.set(hunt);
          this.notify.info(action === 'start' ? 'C’est parti ! Les aventuriers sont lâchés.' : 'Expédition mise à jour.');
        },
        error: (e) => this.notify.error(e),
      });
  }
}
