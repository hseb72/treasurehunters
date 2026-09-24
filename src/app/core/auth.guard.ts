import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Session } from './session';

/** Redirige vers la connexion en mémorisant la page demandée. */
export const authGuard: CanActivateFn = (_route, state) =>
  inject(Session).loggedIn() || inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
