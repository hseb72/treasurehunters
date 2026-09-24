/**
 * Génération de chasses (docs/conception.md § 11) : règles communes au serveur
 * (générateur OpenStreetMap + IA) et au back-end simulé des maquettes.
 */
import { Difficulty, GenerationRequest } from './models.js';

/** Étape d'une chasse inventée ; la première est le départ (ordre 0). */
export interface PlannedStep {
  title: string;
  /** Message affiché à l'arrivée sur le lieu (null pour le départ). */
  arrival: string | null;
  /** Énigme menant à l'étape suivante (null pour l'arrivée). */
  instructions: string | null;
  /** Jokers de l'énigme menant à l'étape suivante, du plus vague au plus précis. */
  hints: string[];
  latitude: number;
  longitude: number;
  address: string | null;
}

export interface HuntPlan {
  name: string;
  description: string;
  startText: string;
  award: string | null;
  steps: PlannedStep[];
}

/** Minutes moyennes par étape (marche + réflexion), selon la difficulté. */
export const MINUTES_PER_STEP: Record<Difficulty, number> = { easy: 10, medium: 12, hard: 15 };
export const MIN_STEPS = 3;
export const MAX_STEPS = 12;

/** Nombre d'étapes à trouver (arrivée comprise) : demandé, ou déduit de la durée. */
export function plannedStepCount(req: Pick<GenerationRequest, 'steps' | 'durationMinutes' | 'difficulty'>): number {
  const n = req.steps ?? Math.round(req.durationMinutes / MINUTES_PER_STEP[req.difficulty]);
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, n));
}

/** Rayon de recherche des lieux autour du point de départ, en mètres (≈ 15 m par minute de jeu). */
export function searchRadius(durationMinutes: number): number {
  return Math.min(2500, Math.max(300, Math.round(durationMinutes * 15)));
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Balade',
  medium: 'Aventure',
  hard: 'Expédition',
};

/**
 * Chasse de démonstration, sans réseau ni IA : quelques lieux fictifs en spirale autour
 * du point de départ. Sert aux maquettes et aux tests du serveur.
 */
export function demoPlan(center: { lat: number; lng: number }, count: number, placeName = 'la ville'): HuntPlan {
  const places = ['la vieille fontaine', 'la statue du fondateur', 'le cadran solaire', 'la porte aux lions', 'le belvédère', 'la chapelle oubliée'];
  const steps: PlannedStep[] = [
    {
      title: 'Départ',
      arrival: null,
      instructions: 'Là où l’eau chante sans jamais se taire, cherchez la première trace de l’expédition.',
      hints: ['Écoutez.', 'De l’eau qui coule, en pleine ville.', 'Une fontaine, tout près du départ.'],
      latitude: center.lat,
      longitude: center.lng,
      address: null,
    },
  ];
  for (let i = 1; i <= count; i++) {
    const angle = i * 2.1;
    const dist = 120 * i; // mètres
    const final = i === count;
    const place = places[(i - 1) % places.length];
    steps.push({
      title: final ? 'Le trésor' : place[0].toUpperCase() + place.slice(1),
      arrival: final ? 'Le trésor était là, sous vos yeux. Bravo, explorateur !' : `Bien joué : vous avez trouvé ${place}.`,
      instructions: final ? null : `Suivez l’ombre de ${places[i % places.length]} pour trouver l’étape suivante.`,
      hints: final ? [] : ['Levez les yeux.', 'Ce n’est pas loin.', `Cherchez ${places[i % places.length]}.`],
      latitude: center.lat + (Math.sin(angle) * dist) / 111_195,
      longitude: center.lng + (Math.cos(angle) * dist) / (111_195 * Math.cos((center.lat * Math.PI) / 180)),
      address: null,
    });
  }
  return {
    name: `Les secrets de ${placeName}`,
    description: `Une expédition inventée pour vous à travers ${placeName}.`,
    startText: 'Votre carnet est vierge, votre boussole prête. L’aventure commence ici.',
    award: null,
    steps,
  };
}
