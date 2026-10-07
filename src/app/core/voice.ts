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

/**
 * Attente de la transcription après le bouton d'arrêt : courte si du texte est déjà arrivé
 * (la fin de phrase suit), plus longue sinon. Chrome Android ne rend souvent le texte qu'une
 * fois l'écoute arrêtée, après l'aller-retour vers les serveurs de Google.
 */
const STOP_GRACE_MS = 1500;
const STOP_WAIT_MS = 6000;

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
  /** Écoute arrêtée, transcription attendue. */
  readonly transcribing = signal(false);
  /** Transcription en cours, mise à jour pendant que le joueur parle. */
  readonly transcript = signal('');
  private recognition: Recognition | null = null;

  /** Demande d'arrêt du joueur pour l'écoute en cours. */
  private stopRequest: (() => void) | null = null;
  /** Fin immédiate de l'écoute en cours, sans attendre le navigateur. */
  private finishNow: (() => void) | null = null;

  /** Écoute une demande ; résout avec le texte final (vide si rien n'a été compris). */
  listen(lang = 'fr-FR'): Promise<string> {
    this.stopSpeaking();
    this.cancel();
    if (!this.ctor) return Promise.reject(new Error('Votre navigateur ne sait pas écouter : écrivez votre demande.'));
    const r = new this.ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    this.recognition = r;
    this.transcript.set('');
    this.listening.set(true);
    return new Promise((resolve, reject) => {
      let final = '';
      let failed: string | null = null;
      let done = false;
      let byUser = false;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      // Une seule fin, qu'elle vienne du navigateur (onend) ou du délai après le bouton d'arrêt.
      const finish = () => {
        if (done) return;
        done = true;
        r.onresult = r.onerror = r.onend = null;
        if (this.recognition === r) this.recognition = null;
        if (this.finishNow === finish) this.finishNow = this.stopRequest = null;
        this.listening.set(false);
        this.transcribing.set(false);
        if (graceTimer) clearTimeout(graceTimer);
        const heard = (final || this.transcript()).trim();
        if (failed && !heard && !byUser) reject(new Error(failed));
        else resolve(heard);
      };
      this.finishNow = finish;
      this.stopRequest = () => {
        byUser = true;
        // Le bouton répond tout de suite ; le texte, lui, peut arriver après l'arrêt.
        this.listening.set(false);
        this.transcribing.set(true);
        graceTimer = setTimeout(finish, this.transcript() ? STOP_GRACE_MS : STOP_WAIT_MS);
      };
      r.onresult = (e) => {
        // Liste complète à chaque fois : Chrome Android renvoie tous les résultats, pas seulement les nouveaux.
        let done = '';
        let interim = '';
        for (let i = 0; i < e.results.length; i++) {
          const text = e.results[i][0].transcript;
          if (e.results[i].isFinal) done += text;
          else interim += text;
        }
        final = done;
        this.transcript.set((done + interim).trim());
        // Arrêt demandé et texte arrivé : plus besoin d'attendre longtemps.
        if (byUser && graceTimer && done.trim()) {
          clearTimeout(graceTimer);
          graceTimer = setTimeout(finish, 300);
        }
      };
      r.onerror = (e) => {
        if (e.error !== 'aborted') failed = ERRORS[e.error] ?? 'Je n’ai pas pu vous écouter. Écrivez votre demande à la place.';
      };
      r.onend = finish;
      try {
        r.start();
      } catch (e) {
        failed = (e as Error).message;
        finish();
      }
    });
  }

  /**
   * Fin de la demande, au bouton d'arrêt. Le navigateur est prié de s'arrêter et de rendre la
   * fin de la phrase ; on ne l'attend pas plus de STOP_GRACE_MS : sur certains téléphones
   * (Chrome Android), sa confirmation tarde ou ne vient jamais.
   */
  stopListening(): void {
    const r = this.recognition;
    if (!r) return;
    this.stopRequest?.();
    try {
      r.stop();
    } catch {
      // Déjà arrêtée.
    }
    // Si le micro reste ouvert malgré tout, on le coupe.
    setTimeout(() => {
      try {
        r.abort();
      } catch {
        // Déjà arrêtée.
      }
    }, STOP_WAIT_MS + 1000);
  }

  /** Abandon de l'écoute (nouvelle écoute, page quittée), sans attendre. */
  private cancel(): void {
    const r = this.recognition;
    this.finishNow?.();
    try {
      r?.abort();
    } catch {
      // Déjà arrêtée.
    }
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
