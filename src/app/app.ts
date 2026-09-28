import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
  protected readonly demo = environment.demo;
  /** Onglets principaux (barre du bas sur téléphone, liens de la barre du haut sinon). */
  protected readonly tabs = [
    { path: '/', icon: 'home', label: 'Accueil' },
    { path: '/catalog', icon: 'travel_explore', label: 'Explorer' },
    { path: '/organize', icon: 'add_circle', label: 'Créer' },
    { path: '/scan', icon: 'qr_code_scanner', label: 'Scanner' },
  ];
  private readonly router = inject(Router);
  private readonly api = inject(HuntApi);

  protected logout(): void {
    // La session locale est effacée même si le serveur ne répond pas.
    this.api.logout().subscribe({ error: () => undefined });
    this.session.set(null);
    this.router.navigateByUrl('/');
  }
}
