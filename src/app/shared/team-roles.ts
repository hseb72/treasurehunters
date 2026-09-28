import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Member, Team } from '@shared/models';
import { TEAM_ROLES, TeamRole, teamRole } from '@shared/roles';
import { HuntApi } from '../core/api';
import { Notify } from '../core/notify';
import { Session } from '../core/session';

/**
 * Écran équipe (§ 41) : chaque membre et son rôle (« 🧭 Paul — navigation »). Chacun choisit le
 * sien ; le créateur de l'équipe peut aussi répartir ceux des autres. Rien d'obligatoire.
 */
@Component({
  selector: 'th-team-roles',
  imports: [MatButtonModule, MatIconModule, MatMenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="roster">
      @for (m of team().members; track m.hunterId) {
        <li>
          <span class="avatar" [class.me]="m.hunterId === me()">{{ m.nickname.charAt(0).toUpperCase() }}</span>
          <span class="who">
            <strong>{{ m.nickname }}</strong>
            @if (role(m); as r) {
              <span class="role"><mat-icon inline>{{ r.icon }}</mat-icon>{{ r.label }} — {{ r.task }}</span>
            } @else {
              <span class="role muted">sans rôle</span>
            }
          </span>
          @if (canEdit(m)) {
            <button mat-icon-button type="button" [matMenuTriggerFor]="menu" [matMenuTriggerData]="{ member: m }" [attr.aria-label]="'Rôle de ' + m.nickname">
              <mat-icon>edit</mat-icon>
            </button>
          }
        </li>
      }
    </ul>
    <mat-menu #menu="matMenu">
      <ng-template matMenuContent let-member="member">
        @for (r of roles; track r.id) {
          <button mat-menu-item type="button" (click)="choose(member, r.id)">
            <mat-icon>{{ r.icon }}</mat-icon>{{ r.label }} <span class="muted small">· {{ r.task }}</span>
          </button>
        }
        <button mat-menu-item type="button" (click)="choose(member, null)"><mat-icon>block</mat-icon>Sans rôle</button>
      </ng-template>
    </mat-menu>
    @if (!team().solo && team().members.length > 1 && !anyRole()) {
      <p class="small muted hint">Envie de jouer au rallye ? Répartissez-vous les rôles : capitaine, navigateur, lecteur, déchiffreur, photographe.</p>
    }
  `,
  styles: `
    .roster { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    li { display: flex; align-items: center; gap: 10px; }
    .avatar { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--th-surface-sunken); color: var(--th-primary); font-weight: 700; }
    .avatar.me { background: var(--th-primary); color: var(--th-on-primary); }
    .who { display: flex; flex-direction: column; flex: 1; min-width: 0; text-align: left; }
    .role { font-size: 0.85rem; color: var(--th-ink-soft); }
    .role mat-icon { color: var(--th-primary); margin-right: 4px; }
    .hint { margin: 0; }
  `,
})
export class TeamRoles {
  readonly team = input.required<Team>();
  readonly changed = output<Team>();
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly session = inject(Session);
  protected readonly roles = TEAM_ROLES;
  protected readonly me = computed(() => this.session.user()?.id ?? null);
  protected readonly anyRole = computed(() => this.team().members.some((m) => m.role));

  protected role(m: Member) {
    return teamRole(m.role);
  }

  protected canEdit(m: Member): boolean {
    return m.hunterId === this.me() || this.team().ownerId === this.me();
  }

  protected choose(m: Member, role: TeamRole | null): void {
    this.api.setRole(this.team().id, role, m.hunterId === this.me() ? undefined : m.hunterId).subscribe({
      next: (t) => this.changed.emit(t),
      error: (e) => this.notify.error(e),
    });
  }
}
