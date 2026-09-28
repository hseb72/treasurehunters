import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { environment } from '../environments/environment';
import { HuntApi } from './core/api';
import { Session } from './core/session';
import { CompassLogo } from './shared/compass-logo';

@Component({
  selector: 'app-root',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, RouterLink, RouterLinkActive, RouterOutlet, CompassLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  protected readonly demo = environment.demo;
  /** Onglets principaux (barre du bas sur téléphone, liens de la barre du haut sinon). */
  /** Pendant une partie, le carnet de route a sa propre barre d'outils. */
  protected readonly playing = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/play/')),
      startWith(this.router.url.startsWith('/play/')),
    ),
    { initialValue: false },
  );
  protected readonly tabs = [
    { path: '/', icon: 'home', label: 'Accueil' },
    { path: '/catalog', icon: 'travel_explore', label: 'Explorer' },
    { path: '/organize', icon: 'add_circle', label: 'Créer' },
    { path: '/scan', icon: 'qr_code_scanner', label: 'Scanner' },
  ];
  private readonly api = inject(HuntApi);

  protected logout(): void {
    // La session locale est effacée même si le serveur ne répond pas.
    this.api.logout().subscribe({ error: () => undefined });
    this.session.set(null);
    this.router.navigateByUrl('/');
  }
}
