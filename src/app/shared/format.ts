import { Pipe, PipeTransform } from '@angular/core';
import { formatDuration } from '@shared/rules';

/** Durée en millisecondes → « 2 j 03 h 12 min », « 1:02:03 » ou « 12:34 » (comptes à rebours et chronos). */
export function formatClock(ms: number): string {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (d > 0) return `${d} j ${pad(h)} h ${pad(m)} min`;
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(seconds: number | null | undefined): string {
    return formatDuration(seconds ?? null);
  }
}
