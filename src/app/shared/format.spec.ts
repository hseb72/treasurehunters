import { formatClock } from './format';
import { penaltyText } from './labels';

describe('formatClock', () => {
  it('formate minutes, heures et jours', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(2 * 86_400_000 + 3 * 3_600_000 + 12 * 60_000)).toBe('2 j 03 h 12 min');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('penaltyText', () => {
  it('résume les pénalités de jokers', () => {
    expect(penaltyText([0, 0, 0])).toBe('');
    expect(penaltyText([3, 3, 3])).toBe('+3 min par joker');
    expect(penaltyText([2, 5, 10])).toBe('+2 min pour le joker 1, +5 min pour le 2, +10 min pour le 3');
  });
});
