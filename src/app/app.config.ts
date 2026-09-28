import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import localeEnGb from '@angular/common/locales/en-GB';
import { currentLang } from './core/lang';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatIconRegistry } from '@angular/material/icon';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { HuntApi } from './core/api';
import { apiInterceptor } from './core/http-hunt-api';
import { HUNT_API_CLASS } from './core/api-provider';

registerLocaleData(localeFr);
registerLocaleData(localeEnGb);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideAppInitializer(() => {
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
    }),
    // Version anglaise (§ 33) : dates et nombres suivent la langue de l'interface.
    { provide: LOCALE_ID, useFactory: () => (currentLang() === 'en' ? 'en-GB' : 'fr-FR') },
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor])),
    // Vrai back-end, ou données simulées pour les maquettes : fichier remplacé par la configuration « mock ».
    { provide: HuntApi, useClass: HUNT_API_CLASS },
  ],
};
