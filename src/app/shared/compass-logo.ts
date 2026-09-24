import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Rose des vents, emblème de l'application. */
@Component({
  selector: 'th-compass-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2.5" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" />
      <path d="M32 6 L37 32 L32 58 L27 32 Z" fill="currentColor" />
      <path d="M6 32 L32 27 L58 32 L32 37 Z" fill="currentColor" opacity=".55" />
      <path d="M32 6 L37 32 L27 32 Z" fill="#9e2b1f" />
      <circle cx="32" cy="32" r="3.5" fill="#3d2413" stroke="currentColor" stroke-width="1.5" />
    </svg>
  `,
  styles: `:host { display: inline-flex; color: var(--th-gold-light); }`,
})
export class CompassLogo {
  readonly size = input(36);
}
