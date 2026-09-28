import { inject, Injectable } from '@angular/core';
import { Notify } from './notify';

/** Partage d'un lien : la feuille de partage du téléphone, sinon le presse-papiers. */
@Injectable({ providedIn: 'root' })
export class ShareLink {
  private readonly notify = inject(Notify);

  async share(title: string, text: string, url: string): Promise<void> {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      this.notify.info('Lien copié : collez-le dans un message.');
    } catch {
      this.notify.info(`Envoyez ce lien : ${url}`);
    }
  }
}
