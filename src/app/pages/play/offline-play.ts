import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { offlineHash, offlineView } from '@shared/offline';
import { comparableAnswer } from '@shared/puzzles';
import { arrivalCheck } from '@shared/rules';
import { currentPosition } from '../../core/geo';
import { Notify } from '../../core/notify';
import { OfflineStore } from '../../core/offline-store';
import { Confirm } from '../../shared/confirm-dialog';
import { ReadAloud } from '../../shared/read-aloud';
import { filter } from 'rxjs';

/**
 * Carnet de route hors ligne (§ 32) : la partie continue sans réseau à partir du paquet
 * enregistré. Chaque action est vérifiée sur place puis mise en attente ; le serveur la
 * rejouera, et la confirmera, au retour du réseau.
 */
@Component({
  selector: 'th-offline-play',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, ReadAloud, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entry(); as e) {
      @let v = view()!;
      <div class="page stack">
        <section class="surface offline-bar" role="status">
          <mat-icon>{{ store.online() ? 'cloud_sync' : 'cloud_off' }}</mat-icon>
          <div>
            <strong>{{ store.online() ? 'Réseau retrouvé' : 'Hors ligne' }}</strong>
            <span class="small">
              @if (e.events.length) {
                {{ e.events.length }} action{{ e.events.length > 1 ? 's' : '' }} en attente de synchronisation.
              } @else {
                Tout est à jour.
              }
            </span>
          </div>
          @if (store.online() && e.events.length) {
            <button mat-flat-button type="button" (click)="store.sync(huntId())" [disabled]="store.syncing()"><mat-icon>sync</mat-icon>Synchroniser</button>
          }
        </section>

        <header class="banner board">
          <span class="small">{{ e.pack.huntName }}</span>
          <h1>{{ e.pack.teamName }}</h1>
          @if (e.progress.started) {
            <span class="small"><mat-icon inline>timer</mat-icon> {{ elapsed() }} · {{ found() }} / {{ v.finalOrder }} lieux</span>
          }
        </header>

        @switch (v.phase) {
          @case ('waiting') {
            <section class="surface center">
              <p>Vous êtes au point de départ ?</p>
              @if (e.pack.selfStart) {
                <button mat-flat-button class="th-cta" type="button" (click)="start()"><mat-icon>flag</mat-icon>C'est parti !</button>
              } @else {
                <p class="small muted">Le départ sera donné par l'organisateur : il faut du réseau pour le recevoir.</p>
              }
            </section>
          }
          @case ('finished') {
            <section class="surface center">
              <span class="stamp stamp--accent">Trésor trouvé !</span>
              <p>Votre arrivée est enregistrée sur ce téléphone. Le temps officiel sera confirmé au retour du réseau.</p>
            </section>
          }
          @case ('puzzle') {
            <section class="surface taped clue">
              <span class="stamp">Épreuve : {{ v.target?.title }}</span>
              <p class="note">{{ v.target?.puzzle?.prompt }}</p>
              @if (v.target?.puzzle?.cipher; as c) {
                <p class="note code">{{ c }}</p>
              }
              @if (v.target?.puzzle?.letters; as l) {
                <p class="note code">{{ l.join(' ') }}</p>
              }
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Votre réponse</mat-label>
                <input matInput [(ngModel)]="answer" (keyup.enter)="solve()" autocomplete="off" />
              </mat-form-field>
              @if (wrong()) {
                <p class="small error-text">Ce n'est pas la bonne réponse.</p>
              }
              <button mat-flat-button type="button" (click)="solve()" [disabled]="!answer.trim()"><mat-icon>lock_open</mat-icon>Valider</button>
            </section>
          }
          @case ('playing') {
            <section class="surface taped clue">
              <div class="clue-head">
                <span class="stamp">{{ v.target?.order === v.finalOrder ? 'Vers le trésor' : 'Énigme n° ' + v.target?.order }}</span>
                <th-read-aloud [text]="spoken()" />
              </div>
              <p class="note clue-text">{{ v.current?.instructions }}</p>
              @for (h of v.hintsRevealed; track $index) {
                <p class="hint"><mat-icon inline>key</mat-icon> <strong>Joker {{ $index + 1 }}</strong> : {{ h }}</p>
              }
              @if (farMessage(); as m) {
                <p class="small error-text" role="alert">{{ m }}</p>
              }
              <div class="row">
                @if (e.pack.validation === 'geo') {
                  <button mat-flat-button class="th-cta" type="button" (click)="arrived()" [disabled]="locating()">
                    <mat-icon>{{ locating() ? 'hourglass_top' : 'where_to_vote' }}</mat-icon>Je suis arrivé
                  </button>
                } @else {
                  <a mat-flat-button class="th-cta" routerLink="/scanner"><mat-icon>qr_code_scanner</mat-icon>Scanner le QR du lieu</a>
                }
                @if (v.current && v.hintsRevealed.length < v.current.hints.length) {
                  <button mat-stroked-button type="button" (click)="hint()"><mat-icon>key</mat-icon>Joker {{ v.hintsRevealed.length + 1 }} / {{ v.current.hints.length }}</button>
                }
                @if (v.canSkip) {
                  <button mat-button type="button" (click)="skip()">Abandonner cette épreuve</button>
                }
              </div>
            </section>
          }
        }

        @if (e.progress.validated.length) {
          <section>
            <h2 class="section-title">Journal de bord</h2>
            <ol class="log">
              @for (s of logLines(); track s.order) {
                <li>{{ s.order }}. {{ s.title }}{{ s.skipped ? ' (abandonnée)' : '' }} <span class="small muted">{{ s.time }}</span></li>
              }
            </ol>
          </section>
        }
      </div>
    }
  `,
  styles: `
    .offline-bar { display: flex; align-items: center; gap: 10px; border: 2px dashed var(--th-accent); }
    .offline-bar > mat-icon { color: var(--th-accent); }
    .offline-bar > div { flex: 1; display: flex; flex-direction: column; }
    .board { padding: 16px 20px; display: flex; flex-direction: column; gap: 2px; }
    .board h1 { margin: 0; }
    .center { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
    .center p { margin: 0; }
    .clue { display: flex; flex-direction: column; gap: 10px; }
    .clue p { margin: 0; }
    .clue-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
    .clue-text { font-size: 1.2rem; }
    .code { letter-spacing: 0.15em; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; }
    .log { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
  `,
})
export class OfflinePlay {
  protected readonly store = inject(OfflineStore);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  readonly huntId = input.required<number>();

  protected readonly entry = computed(() => this.store.get(this.huntId()));
  protected readonly view = computed(() => {
    const e = this.entry();
    return e ? offlineView(e.pack, e.progress) : null;
  });
  protected readonly found = computed(() => this.entry()?.progress.validated.filter((v) => !v.skipped).length ?? 0);
  protected readonly spoken = computed(() => {
    const v = this.view();
    return [v?.current?.instructions ?? '', ...(v?.hintsRevealed ?? []).map((h, i) => `Joker ${i + 1} : ${h}`)].join('\n\n');
  });
  protected readonly logLines = computed(() => {
    const e = this.entry();
    if (!e) return [];
    return e.progress.validated.map((v) => ({
      order: v.order,
      title: e.pack.steps.find((s) => s.order === v.order)?.title ?? '',
      skipped: v.skipped,
      time: new Date(v.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    }));
  });
  private readonly now = signal(Date.now());
  protected readonly elapsed = computed(() => {
    const started = this.entry()?.progress.started;
    if (!started) return '';
    const m = Math.max(0, Math.round((this.now() - Date.parse(started)) / 60_000));
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
  });
  protected readonly locating = signal(false);
  protected readonly farMessage = signal<string | null>(null);
  protected readonly wrong = signal(false);
  protected answer = '';

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected start(): void {
    this.store.record(this.huntId(), { kind: 'start' });
  }

  protected hint(): void {
    const current = this.view()?.current;
    if (!current) return;
    this.confirm
      .ask({ title: 'Prendre un joker ?', message: 'La pénalité prévue par l’organisateur s’ajoutera à votre temps.', confirm: 'Prendre le joker' })
      .pipe(filter(Boolean))
      .subscribe(() => this.store.record(this.huntId(), { kind: 'hint', stepId: current.stepId }));
  }

  protected skip(): void {
    const target = this.view()?.target;
    if (!target) return;
    this.confirm
      .ask({ title: 'Abandonner cette épreuve ?', message: 'L’énigme suivante se dévoile, avec la pénalité d’abandon.', confirm: 'Abandonner', danger: true })
      .pipe(filter(Boolean))
      .subscribe(() => this.store.record(this.huntId(), { kind: 'skip', stepId: target.stepId }));
  }

  protected async arrived(): Promise<void> {
    const e = this.entry();
    const target = this.view()?.target;
    if (!e || !target) return;
    this.locating.set(true);
    this.farMessage.set(null);
    try {
      const pos = await currentPosition();
      const check = arrivalCheck({ latitude: target.lat, longitude: target.lng, entrances: target.entrances }, e.pack, pos);
      if (!check) this.farMessage.set('Ce lieu n’est pas placé sur la carte : l’organisateur devra le valider.');
      else if (!check.ok) this.farMessage.set(`Pas encore : vous êtes à ${check.distance} m du lieu (${check.allowed} m au plus).`);
      else {
        this.store.record(this.huntId(), { kind: 'arrive', stepId: target.stepId, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
        this.notify.info(target.puzzle ? 'Vous y êtes : une épreuve vous attend.' : `Trouvé : ${target.title} !`);
      }
    } catch (err) {
      this.notify.error(err);
    } finally {
      this.locating.set(false);
    }
  }

  protected async solve(): Promise<void> {
    const target = this.view()?.target;
    const value = this.answer.trim();
    if (!target?.puzzle || !value) return;
    const hash = await offlineHash(target.stepId, comparableAnswer(target.puzzle, value));
    if (!target.answerHashes?.includes(hash)) {
      this.wrong.set(true);
      return;
    }
    this.wrong.set(false);
    this.answer = '';
    this.store.record(this.huntId(), { kind: 'answer', stepId: target.stepId, answer: value });
  }
}
