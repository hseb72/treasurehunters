import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { environment } from '../environments/environment';
import { HuntApi } from './core/api';
import { Session } from './core/session';
import { CompassLogo } from './shared/compass-logo';

@Component({
  selector: 'app-root',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatSidenavModule, MatListModule, RouterLink, RouterLinkActive, RouterOutlet, CompassLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly session = inject(Session);
  protected readonly demo = environment.demo;
  private readonly router = inject(Router);
  private readonly api = inject(HuntApi);

  protected logout(): void {
    // La session locale est effacée même si le serveur ne répond pas.
    this.api.logout().subscribe({ error: () => undefined });
    this.session.set(null);
    this.router.navigateByUrl('/');
  }
}
