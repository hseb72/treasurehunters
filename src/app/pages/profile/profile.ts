import { ChangeDetectionStrategy, Component, effect, inject, input, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { take, timer } from 'rxjs';
import { GenerationAccessPanel } from '../../shared/generation-access-panel';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';
import { Session } from '../../core/session';

@Component({
  selector: 'th-profile',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSlideToggleModule, RouterLink, GenerationAccessPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <form class="surface stack card" [formGroup]="form" (ngSubmit)="save()">
        <h1><mat-icon>badge</mat-icon> Mon profil</h1>
        <mat-form-field>
          <mat-label>Pseudo</mat-label>
          <input matInput formControlName="nickname" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>E-mail</mat-label>
          <input matInput type="email" formControlName="email" />
        </mat-form-field>
        <mat-slide-toggle formControlName="rateable">Être noté en tant qu'organisateur</mat-slide-toggle>
        <p class="small muted hint">
          Les joueurs de vos chasses pourront noter votre organisation. La moyenne s'affiche sur votre fiche publique d'organisateur, à côté de
          vos chasses au catalogue.
          @if (session.user(); as u) {
            <a [routerLink]="['/organizers', u.id]">Voir ma fiche</a>
          }
        </p>
        <div class="row">
          <span class="spacer"></span>
          <button mat-flat-button type="submit" [disabled]="form.invalid || form.pristine">Enregistrer</button>
        </div>
      </form>

      @if (access.value(); as a) {
        <section class="surface stack card">
          <h2><mat-icon>toll</mat-icon> Chasses sur mesure</h2>
          <th-generation-access [access]="a" [showOffers]="true" returnPath="/me" (changed)="access.reload()" />
          <a mat-stroked-button routerLink="/generate"><mat-icon>auto_awesome</mat-icon>Inventer une chasse</a>
        </section>
      }
    </div>
  `,
  styles: `
    .card { max-width: 480px; margin: 16px auto; gap: 4px; }
    h1, h2 { display: flex; align-items: center; gap: 8px; }
    h2 { margin: 0; }
    .hint { margin: 0 0 8px; }
  `,
})
export class ProfilePage {
  private readonly api = inject(HuntApi);
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly notify = inject(Notify);
  /** Portefeuille de la chasse sur mesure (§ 21) : forfait, crédits achetés et gagnés. */
  protected readonly access = rxResource({ stream: () => this.api.generationAccess() });
  /** Retour de la page de paiement. */
  readonly paid = input<string | undefined>();

  constructor() {
    effect(() => {
      if (this.paid() === undefined) return;
      untracked(() => {
        this.notify.info(this.paid() === '1' ? 'Paiement reçu, merci !' : 'Paiement annulé : rien n’a été débité.');
        this.router.navigate([], { queryParams: {}, replaceUrl: true });
        timer(0, 2000).pipe(take(4)).subscribe(() => this.access.reload());
      });
    });
  }

  protected readonly form = inject(FormBuilder).nonNullable.group({
    nickname: [this.session.user()?.nickname ?? '', Validators.required],
    email: [this.session.user()?.email ?? '', [Validators.required, Validators.email]],
    rateable: [this.session.user()?.rateable ?? false],
  });

  protected save(): void {
    this.api.updateMe(this.form.getRawValue()).subscribe({
      next: (user) => {
        this.session.updateUser(user);
        this.form.markAsPristine();
        this.notify.info('Profil enregistré.');
      },
      error: (e) => this.notify.error(e),
    });
  }
}
