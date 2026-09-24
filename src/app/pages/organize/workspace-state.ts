import { inject, Injectable, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { HuntApi } from '../../core/api';

/** Chasse ouverte dans l'espace organisateur, partagée entre ses onglets. */
@Injectable()
export class WorkspaceState {
  private readonly api = inject(HuntApi);
  readonly huntId = signal<number>(0);
  readonly hunt = rxResource({
    params: () => this.huntId() || undefined,
    stream: ({ params }) => this.api.getHunt(params),
  });
}
