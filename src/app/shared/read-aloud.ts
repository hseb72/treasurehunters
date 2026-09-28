import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DomTranslator } from '../core/dom-translator';

/**
 * Lecture à voix haute (§ 27) : la synthèse vocale du navigateur lit l'énigme, en français.
 * Pratique en marchant, et pour les enfants qui ne lisent pas encore. Rien n'est envoyé
 * nulle part ; le bouton n'apparaît pas si le navigateur ne sait pas parler.
 */
@Component({
  selector: 'th-read-aloud',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (supported) {
      <button mat-button type="button" class="read" (click)="toggle()" [attr.aria-pressed]="speaking()">
        <mat-icon>{{ speaking() ? 'stop_circle' : 'volume_up' }}</mat-icon>{{ speaking() ? 'Arrêter' : 'Écouter' }}
      </button>
    }
  `,
  styles: `
    :host { display: inline-flex; }
    .read { min-width: 0; }
  `,
})
export class ReadAloud {
  readonly text = input.required<string>();
  protected readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  protected readonly speaking = signal(false);
  private utterance: SpeechSynthesisUtterance | null = null;
  private readonly i18n = inject(DomTranslator);

  constructor() {
    // Nouvelle énigme : la lecture de la précédente s'arrête.
    effect(() => {
      this.text();
      untracked(() => this.stop());
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected toggle(): void {
    if (this.speaking()) {
      this.stop();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    // Version anglaise (§ 33) : chaque paragraphe traduit, lu par une voix anglaise.
    const english = this.i18n.english;
    const text = english ? this.text().split('\n\n').map((p) => this.i18n.t(p)).join('\n\n') : this.text();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = english ? 'en-GB' : 'fr-FR';
    u.rate = 0.95;
    const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(english ? 'en' : 'fr'));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => {
      if (this.utterance === u) {
        this.utterance = null;
        this.speaking.set(false);
      }
    };
    this.utterance = u;
    this.speaking.set(true);
    synth.speak(u);
  }

  private stop(): void {
    if (!this.supported) return;
    if (this.utterance) window.speechSynthesis.cancel();
    this.utterance = null;
    this.speaking.set(false);
  }
}
