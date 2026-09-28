/**
 * Fiabilité GPS par étape (docs/conception.md § 42) : à partir des « Je suis arrivé » des joueurs
 * et des vérifications de l'auteur en répétition, repérer les points où le GPS déclenche mal —
 * trop loin du lieu, ou pas du tout. Calcul commun au serveur et à la maquette.
 */

/** Écart au-delà duquel un déclenchement est jugé imprécis, en mètres. */
export const FAR_METERS = 20;
/** Vérifications nécessaires avant de juger une étape. */
export const GPS_MIN_CHECKS = 3;

export interface GeoCheck {
  ok: boolean;
  distance: number;
  accuracy: number | null;
  source: 'play' | 'test';
}

export interface StepReliability {
  stepId: number;
  order: number;
  title: string;
  /** Vérifications de l'auteur en répétition, et « Je suis arrivé » des joueurs. */
  tests: number;
  plays: number;
  /** Déclenchements réussis, dont ceux à plus de FAR_METERS du point. */
  triggered: number;
  far: number;
  /** Tentatives refusées (trop loin). */
  failed: number;
  /** Précision moyenne annoncée par les téléphones, en mètres. */
  accuracy: number | null;
  /** Étape jugée instable, et pourquoi. */
  unstable: boolean;
  reasons: string[];
}

export function stepReliability(step: { id: number; order: number; title: string }, checks: GeoCheck[]): StepReliability {
  const n = checks.length;
  const triggered = checks.filter((c) => c.ok).length;
  const far = checks.filter((c) => c.ok && c.distance > FAR_METERS).length;
  const failed = n - triggered;
  const acc = checks.map((c) => c.accuracy).filter((a): a is number => a !== null);
  const accuracy = acc.length ? Math.round(acc.reduce((a, b) => a + b, 0) / acc.length) : null;
  const reasons: string[] = [];
  if (n >= GPS_MIN_CHECKS) {
    if (far && far / Math.max(1, triggered) >= 0.3) reasons.push(`${far} déclenchement${far > 1 ? 's' : ''} sur ${n} à plus de ${FAR_METERS} m du point`);
    if (failed / n >= 0.3) reasons.push(`${failed} tentative${failed > 1 ? 's' : ''} sur ${n} refusée${failed > 1 ? 's' : ''}, trop loin`);
    if (accuracy !== null && accuracy > 25) reasons.push(`précision moyenne des téléphones : ${accuracy} m`);
  }
  return {
    stepId: step.id,
    order: step.order,
    title: step.title,
    tests: checks.filter((c) => c.source === 'test').length,
    plays: checks.filter((c) => c.source === 'play').length,
    triggered,
    far,
    failed,
    accuracy,
    unstable: reasons.length > 0,
    reasons,
  };
}
