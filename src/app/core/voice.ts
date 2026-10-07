import { Injectable, signal } from '@angular/core';

/** Reconnaissance vocale du navigateur (préfixée « webkit » sur Chrome et Safari). */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

const ERRORS: Record<string, string> = {
  'not-allowed': 'Autorisez le micro pour ce site dans les réglages du navigateur.',
  'service-not-allowed': 'Autorisez le micro pour ce site dans les réglages du navigateur.',
  'no-speech': 'Je n’ai rien entendu. Touchez le micro et parlez près du téléphone.',
  'audio-capture': 'Aucun micro disponible sur cet appareil.',
  network: 'La reconnaissance vocale a besoin d’une connexion. Écrivez votre demande à la place.',
};

/**
 * Voix du guide (§ 46) : la reconnaissance et la synthèse vocales du navigateur. Le navigateur
 * demande lui-même l'autorisation du micro ; selon l'appareil, la transcription passe par les
 * serveurs d'Apple ou de Google. Sans prise en charge (Firefox), le joueur écrit sa demande.
 */
@Injectable({ providedIn: 'root' })
export class Voice {
  private readonly ctor: RecognitionCtor | null =
    typeof window === 'undefined' ? null : ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition ?? null);
  readonly canListen = !!this.ctor;
  readonly canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

  readonly listening = signal(false);
  /** Transcription en cours, mise à jour pendant que le joueur parle. */
  readonly transcript = signal('');
  private recognition: Recognition | null = null;

  /** Écoute une demande ; résout avec le texte final (vide si rien n'a été compris). */
  listen(lang = 'fr-FR'): Promise<string> {
    this.stopSpeaking();
    this.recognition?.abort();
    if (!this.ctor) return Promise.reject(new Error('Votre navigateur ne sait pas écouter : écrivez votre demande.'));
    const r = new this.ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    this.recognition = r;
    this.transcript.set('');
    this.listening.set(true);
    let final = '';
    return new Promise((resolve, reject) => {
      let failed: string | null = null;
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const text = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += text;
          else interim += text;
        }
        this.transcript.set((final + interim).trim());
      };
      r.onerror = (e) => {
        if (e.error !== 'aborted') failed = ERRORS[e.error] ?? 'Je n’ai pas pu vous écouter. Écrivez votre demande à la place.';
      };
      r.onend = () => {
        this.listening.set(false);
        if (this.recognition === r) this.recognition = null;
        if (failed && !final.trim()) reject(new Error(failed));
        else resolve((final || this.transcript()).trim());
      };
      r.start();
    });
  }

  /** Fin de la demande : la transcription se termine avec ce qui a été dit. */
  stopListening(): void {
    this.recognition?.stop();
  }

  speak(text: string, lang = 'fr-FR'): void {
    if (!this.canSpeak) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1;
    const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2)));
    if (voice) u.voice = voice;
    synth.speak(u);
  }

  stopSpeaking(): void {
    if (this.canSpeak) window.speechSynthesis.cancel();
  }
}
