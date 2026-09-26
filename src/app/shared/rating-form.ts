import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { of } from 'rxjs';
import { HuntApi } from '../core/api';
import { Notify } from '../core/notify';
import { Session } from '../core/session';
import { StarInput } from './stars';

/**
 * Avis d'un joueur sur une chasse close (§ 14) : note globale, trois critères, commentaire,
 * et la note de l'organisateur s'il accepte d'être noté. On peut le modifier ensuite.
 */
@Component({
  selector: 'th-rating-form',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, StarInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state.value(); as s) {
      @if (s.canRate) {
        <form class="parchment stack rating" (ngSubmit)="save()">
          <h2 class="section-title">{{ s.mine ? 'Votre avis' : 'Votre avis sur cette chasse' }}</h2>
          <p class="small muted">Il aide les autres organisateurs à choisir leurs chasses dans le catalogue.</p>
          <th-star-input label="Note globale" [(value)]="stars" />
          <th-star-input label="Les énigmes" [(value)]="riddles" />
          <th-star-input label="Le parcours" [(value)]="route" />
          <th-star-input label="L'ambiance" [(value)]="mood" />
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Un mot pour les prochains aventuriers (facultatif)</mat-label>
            <textarea matInput name="comment" rows="3" maxlength="2000" [ngModel]="comment()" (ngModelChange)="comment.set($event)"></textarea>
          </mat-form-field>
          @if (s.organizerRateable) {
            <th-star-input [label]="'L’organisation de ' + s.organizerNickname" [(value)]="organizer" />
          }
          <div class="row">
            @if (s.mine) {
              <span class="small muted"><mat-icon inline>check</mat-icon> Avis enregistré, vous pouvez le modifier.</span>
            }
            <span class="spacer"></span>
            <button mat-flat-button type="submit" [disabled]="!complete() || busy()">{{ s.mine ? 'Mettre à jour' : 'Envoyer mon avis' }}</button>
          </div>
        </form>
      }
    }
  `,
  styles: `
    .rating { gap: 10px; }
  `,
})
export class RatingForm {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);
  private readonly session = inject(Session);

  readonly huntId = input.required<number>();

  protected readonly state = rxResource({
    params: () => ({ id: this.huntId(), user: this.session.user()?.id }),
    stream: ({ params }) => (params.user ? this.api.getRating(params.id) : of(null)),
  });
  protected readonly stars = signal<number | null>(null);
  protected readonly riddles = signal<number | null>(null);
  protected readonly route = signal<number | null>(null);
  protected readonly mood = signal<number | null>(null);
  protected readonly organizer = signal<number | null>(null);
  protected readonly comment = signal('');
  protected readonly busy = signal(false);

  protected readonly complete = computed(() => {
    const s = this.state.value();
    return !!this.stars() && !!this.riddles() && !!this.route() && !!this.mood() && (!s?.organizerRateable || !!this.organizer());
  });

  constructor() {
    // Un avis déjà donné préremplit le formulaire.
    effect(() => {
      const mine = this.state.value()?.mine;
      if (!mine) return;
      this.stars.set(mine.stars);
      this.riddles.set(mine.riddles);
      this.route.set(mine.route);
      this.mood.set(mine.mood);
      this.organizer.set(mine.organizer);
      this.comment.set(mine.comment ?? '');
    });
  }

  protected save(): void {
    this.busy.set(true);
    this.api
      .rateHunt(this.huntId(), {
        stars: this.stars()!,
        riddles: this.riddles()!,
        route: this.route()!,
        mood: this.mood()!,
        comment: this.comment().trim() || null,
        organizer: this.organizer(),
      })
      .subscribe({
        next: (s) => {
          this.state.set(s);
          this.busy.set(false);
          this.notify.info('Merci pour votre avis !');
        },
        error: (e) => {
          this.notify.error(e);
          this.busy.set(false);
        },
      });
  }
}
