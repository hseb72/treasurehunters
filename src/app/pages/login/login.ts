import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { HuntApi } from '../../core/api';
import { AuthResult } from '@shared/models';
import { Session } from '../../core/session';
import { CompassLogo } from '../../shared/compass-logo';

@Component({
  selector: 'th-login',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTabsModule, CompassLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  private readonly api = inject(HuntApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly returnUrl = input<string>('/');

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected readonly registerForm = this.fb.group({
    nickname: ['', [Validators.required, Validators.maxLength(50)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected readonly demo = environment.demo;
  protected readonly demoAccounts = [
    { nickname: 'seb', email: 'seb@example.com', role: 'joueur, en pleine course' },
    { nickname: 'Camille', email: 'camille@example.com', role: 'organisatrice' },
  ];

  protected useDemo(email: string): void {
    this.loginForm.setValue({ email, password: 'demo' });
    this.login();
  }

  protected login(): void {
    if (this.loginForm.invalid) return this.loginForm.markAllAsTouched();
    const { email, password } = this.loginForm.getRawValue();
    this.run(this.api.login(email, password));
  }

  protected register(): void {
    if (this.registerForm.invalid) return this.registerForm.markAllAsTouched();
    const { nickname, email, password } = this.registerForm.getRawValue();
    this.run(this.api.register(nickname, email, password));
  }

  private run(call: Observable<AuthResult>): void {
    this.busy.set(true);
    this.error.set(null);
    call.subscribe({
      next: (auth) => {
        this.session.set(auth);
        this.router.navigateByUrl(this.returnUrl() || '/');
      },
      error: (e: Error) => {
        this.error.set(e.message);
        this.busy.set(false);
      },
    });
  }
}
