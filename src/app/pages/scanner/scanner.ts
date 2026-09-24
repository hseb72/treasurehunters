import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';

/** API BarcodeDetector (Chrome/Android) ; absente d'iOS, d'où la saisie manuelle en secours. */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
declare const BarcodeDetector: { new (opts: { formats: string[] }): BarcodeDetectorLike } | undefined;

@Component({
  selector: 'th-scanner',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scanner.html',
  styleUrl: './scanner.scss',
})
export class ScannerPage {
  private readonly router = inject(Router);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly camera = signal<'off' | 'starting' | 'on' | 'unsupported' | 'denied'>('off');
  protected readonly manual = signal('');
  private stream: MediaStream | null = null;
  private loop: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected async start(): Promise<void> {
    if (typeof BarcodeDetector === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.camera.set('unsupported');
      return;
    }
    this.camera.set('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = this.video()!.nativeElement;
      video.srcObject = this.stream;
      await video.play();
      this.camera.set('on');
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        const codes = await detector.detect(video).catch(() => []);
        if (codes.length) this.open(codes[0].rawValue);
        else this.loop = setTimeout(tick, 250);
      };
      tick();
    } catch {
      this.camera.set('denied');
    }
  }

  protected submitManual(): void {
    if (this.manual().trim()) this.open(this.manual().trim());
  }

  /** Accepte une URL complète de QR (…/q/<jeton>) ou le jeton seul. */
  private open(value: string): void {
    this.stop();
    const match = value.match(/\/q\/([A-Za-z0-9]+)/);
    this.router.navigate(['/q', match ? match[1] : value]);
  }

  private stop(): void {
    if (this.loop) clearTimeout(this.loop);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
