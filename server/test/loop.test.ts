import { describe, expect, it } from 'vitest';
import { HuntPlan, LOOP_MAX_METERS } from '../../shared/generation.js';
import { planWithLoop, returnDistance } from '../src/generation/claude.js';

/** Plan minimal : rendez-vous au point (43.6, 3.88), trésor à `meters` mètres au nord. */
function plan(meters: number, title = 'Trésor'): { plan: HuntPlan } {
  const step = (lat: number, t: string) => ({ title: t, arrival: null, instructions: null, hints: [], latitude: lat, longitude: 3.88, address: null });
  return { plan: { name: 'N', description: 'D', startText: 'S', award: null, steps: [step(43.6, 'Départ'), step(43.602, 'Milieu'), step(43.6 + meters / 111_195, title)] } };
}

describe('boucle : le trésor revient près du rendez-vous (§ 11.2)', () => {
  it('mesure la distance du trésor au rendez-vous', () => {
    expect(returnDistance(plan(400).plan)).toBe(400);
  });

  it('garde la première proposition quand la boucle est fermée, sans second appel', async () => {
    const asks: (string | null)[] = [];
    const result = await planWithLoop({ travel: 'walk' }, async (extra) => (asks.push(extra), plan(350)));
    expect(returnDistance(result.plan)).toBe(350);
    expect(asks).toEqual([null]);
  });

  it('fait reprendre une fois un trésor trop loin, en donnant l’écart et la limite', async () => {
    const asks: (string | null)[] = [];
    const answers = [plan(3000, 'Le moulin'), plan(420)];
    const result = await planWithLoop({ travel: 'walk' }, async (extra) => (asks.push(extra), answers.shift()!));
    expect(returnDistance(result.plan)).toBe(420);
    expect(asks).toHaveLength(2);
    expect(asks[1]).toMatch(/« Le moulin ».*3\.0 km/);
    expect(asks[1]).toMatch(new RegExp(`moins de ${LOOP_MAX_METERS.walk} m`));
  });

  it('garde la version au retour le plus court si la reprise fait pire', async () => {
    const answers = [plan(2000), plan(2600)];
    const result = await planWithLoop({ travel: 'walk' }, async () => answers.shift()!);
    expect(returnDistance(result.plan)).toBe(2000);
  });

  it('adapte la limite au déplacement : 3 km passe en Expédition', async () => {
    const asks: (string | null)[] = [];
    await planWithLoop({ travel: 'motor' }, async (extra) => (asks.push(extra), plan(3000)));
    expect(asks).toHaveLength(1);
  });
});
