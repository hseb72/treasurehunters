import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, numberAttribute, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Souvenir } from '@shared/models';
import { skinById } from '@shared/skins';
import { HuntApi } from '../../core/api';
import { Notify } from '../../core/notify';
import { SkinDirective } from '../../shared/skin';
import { drawSouvenir, readStyle, SOUVENIR_HEIGHT, SOUVENIR_WIDTH, souvenirTime } from './souvenir-drawing';

/**
 * Souvenir de fin de partie (§ 24) : une image à garder ou à partager, dessinée sur le
 * téléphone. La photo d'équipe éventuelle n'est jamais envoyée : elle reste sur l'appareil.
 */
@Component({
  selector: 'th-souvenir',
  imports: [MatButtonModule, MatIconModule, RouterLink, SkinDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './souvenir.html',
  styleUrl: './souvenir.scss',
})
export class SouvenirPage {
  private readonly api = inject(HuntApi);
  private readonly notify = inject(Notify);

  readonly id = input.required({ transform: numberAttribute });

  protected readonly souvenir = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.getSouvenir(params) });
  private readonly skinHost = viewChild<ElementRef<HTMLElement>>('skinHost');
  /** Photo d'équipe choisie sur l'appareil. */
  private readonly photo = signal<ImageBitmap | null>(null);
  protected readonly hasPhoto = signal(false);
  protected readonly image = signal<{ url: string; blob: Blob } | null>(null);
  protected readonly canShare = signal(false);

  constructor() {
    effect(() => {
      const s = this.souvenir.value();
      const host = this.skinHost()?.nativeElement;
      const photo = this.photo();
      if (s && host) void this.render(s, host, photo);
    });
    inject(DestroyRef).onDestroy(() => {
      const img = this.image();
      if (img) URL.revokeObjectURL(img.url);
      this.photo()?.close();
    });
  }

  protected async pickPhoto(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.photo()?.close();
      this.photo.set(await createImageBitmap(file));
      this.hasPhoto.set(true);
    } catch {
      this.notify.error(new Error('Cette image ne peut pas être lue : essayez une photo JPEG ou PNG.'));
    }
  }

  protected removePhoto(): void {
    this.photo()?.close();
    this.photo.set(null);
    this.hasPhoto.set(false);
  }

  protected async share(): Promise<void> {
    const img = this.image();
    const s = this.souvenir.value();
    if (!img || !s) return;
    const file = new File([img.blob], this.fileName(s), { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: s.huntName, text: this.shareText(s) });
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') this.notify.error(new Error('Le partage a échoué : téléchargez l’image à la place.'));
    }
  }

  protected fileName(s: Souvenir): string {
    const slug = s.huntName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    return `souvenir-${slug || 'chasse'}.png`;
  }

  private shareText(s: Souvenir): string {
    const rank = s.rank !== null ? `, ${s.rank}${s.rank === 1 ? 'ʳᵉ' : 'ᵉ'} sur ${s.ranked}` : '';
    const link = s.catalogId !== null ? ` ${location.origin}/catalog/${s.catalogId}` : '';
    return `Trésor trouvé : « ${s.huntName} » en ${souvenirTime(s.time)}${rank} !${link}`;
  }

  private async render(s: Souvenir, host: HTMLElement, photo: ImageBitmap | null): Promise<void> {
    await document.fonts.ready;
    const canvas = document.createElement('canvas');
    canvas.width = SOUVENIR_WIDTH;
    canvas.height = SOUVENIR_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const style = readStyle(host);
    const cover = photo ?? (await loadImage(skinById(s.skin).cover));
    drawSouvenir(ctx, s, style, cover, location.origin);
    let blob = await toBlob(canvas);
    // Couverture d'un autre site qui refuse d'être copiée : on redessine sans elle.
    if (!blob && cover && !photo) {
      drawSouvenir(ctx, s, style, null, location.origin);
      blob = await toBlob(canvas);
    }
    if (!blob || this.souvenir.value() !== s || this.photo() !== photo) return;
    const old = this.image();
    if (old) URL.revokeObjectURL(old.url);
    this.image.set({ url: URL.createObjectURL(blob), blob });
    const file = new File([blob], this.fileName(s), { type: 'image/png' });
    this.canShare.set(typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }));
  }
}

function loadImage(src: string | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    if (src.startsWith('https:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  });
}
