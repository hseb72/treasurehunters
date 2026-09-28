import { ASSIST_LIMITS, assistUsage } from './assist.js';

const DAY = 86_400_000;
const now = Date.parse('2026-09-28T12:00:00Z');
const ago = (days: number) => new Date(now - days * DAY).toISOString();

describe('assistUsage', () => {
  it('compte les suggestions des 30 derniers jours, par nature, et dit quand la plus ancienne revient', () => {
    const u = assistUsage(
      [
        { action: 'rephrase', at: ago(40) }, // hors fenêtre
        { action: 'rephrase', at: ago(20) },
        { action: 'hints', at: ago(3) },
        { action: 'review', at: ago(0.1) },
      ],
      'base',
      now,
    );
    expect(u).toMatchObject({ plan: 'base', limit: ASSIST_LIMITS.monthly, used: 3, remaining: ASSIST_LIMITS.monthly - 3, today: 1, blocked: null });
    expect(u.byAction).toEqual({ rephrase: 1, easier: 0, harder: 0, hints: 1, review: 1, diagnose: 0 });
    expect(u.nextRefill).toBe(new Date(now + 10 * DAY).toISOString());
  });

  it('bloque une fois le quota mensuel ou quotidien atteint', () => {
    const month = Array.from({ length: ASSIST_LIMITS.monthly }, (_, i) => ({ action: 'rephrase' as const, at: ago(2 + i / 2) }));
    expect(assistUsage(month, 'base', now)).toMatchObject({ remaining: 0, blocked: expect.stringContaining('30 derniers jours') });
    expect(assistUsage(month, 'pass', now)).toMatchObject({ remaining: ASSIST_LIMITS.passMonthly - ASSIST_LIMITS.monthly, blocked: null });
    const day = Array.from({ length: ASSIST_LIMITS.daily }, () => ({ action: 'hints' as const, at: ago(0.2) }));
    expect(assistUsage(day, 'founder', now).blocked).toContain('24 heures');
  });

  it('sans suggestion : tout reste, rien ne revient', () => {
    expect(assistUsage([], 'base', now)).toMatchObject({ used: 0, remaining: ASSIST_LIMITS.monthly, nextRefill: null });
  });
});
