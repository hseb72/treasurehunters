/**
 * Génération de chasses (docs/conception.md § 11) : règles communes au serveur
 * (générateur OpenStreetMap + IA) et au back-end simulé des maquettes.
 */
import { Difficulty, GenerationRequest, Travel } from './models.js';
import { Puzzle, PuzzleType } from './puzzles.js';

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
  /** Autres points d'où l'étape se valide : les entrées d'un parc, d'un musée… */
  entrances?: { lat: number; lng: number }[];
  /** Lieu OpenStreetMap d'origine (« w42 »), pour placer l'étape à son entrée. */
  source?: string;
  /** Épreuve d'arrivée proposée par l'IA (§ 17.1), à résoudre sur ce lieu. */
  puzzle?: Puzzle | null;
  /** Photo libre du lieu (§ 47), dévoilée à l'arrivée ou à l'abandon : vignette à télécharger et crédit. */
  photo?: { url: string; credit: { text: string; url: string | null } } | null;
}

export interface HuntPlan {
  name: string;
  description: string;
  startText: string;
  award: string | null;
  steps: PlannedStep[];
}

/** Minutes moyennes par étape (trajet + réflexion) selon le déplacement : un trajet en voiture compte le stationnement. */
export const MINUTES_PER_STEP: Record<Travel, number> = { walk: 12, active: 10, motor: 20 };
/** Des énigmes plus corsées demandent plus de réflexion à chaque étape. */
const DIFFICULTY_EXTRA_MINUTES: Record<Difficulty, number> = { easy: -2, medium: 0, hard: 3 };
export const MIN_STEPS = 3;
export const MAX_STEPS = 12;

/** Nombre d'étapes à trouver (arrivée comprise) : demandé, ou déduit de la durée. */
export function plannedStepCount(req: Pick<GenerationRequest, 'steps' | 'durationMinutes' | 'travel' | 'difficulty'>): number {
  const perStep = MINUTES_PER_STEP[req.travel] + DIFFICULTY_EXTRA_MINUTES[req.difficulty];
  const n = req.steps ?? Math.round(req.durationMinutes / perStep);
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, n));
}

/**
 * Rayon de recherche des lieux autour du point de départ, en mètres : environ 15 m par minute
 * de jeu à pied, 45 m à vélo ou trottinette, 250 m en véhicule (arrêts et recherche compris).
 */
const SEARCH: Record<Travel, { perMinute: number; min: number; max: number }> = {
  walk: { perMinute: 15, min: 300, max: 2500 },
  active: { perMinute: 45, min: 800, max: 8000 },
  motor: { perMinute: 250, min: 3000, max: 30000 },
};

export function searchRadius(durationMinutes: number, travel: Travel = 'walk'): number {
  const s = SEARCH[travel];
  return Math.min(s.max, Math.max(s.min, Math.round(durationMinutes * s.perMinute)));
}

/**
 * Retour au point de départ : distance maximale entre le trésor et le rendez-vous (§ 11.2).
 * Les joueurs viennent souvent au départ en voiture ou en transports ; un trésor à 3 km doublerait
 * la balade d'un retour sans énigme. Le parcours forme donc une boucle.
 */
export const LOOP_MAX_METERS: Record<Travel, number> = { walk: 500, active: 1500, motor: 5000 };

/** Déplacement : les trois formules de chasse. */
export const TRAVEL_LABELS: Record<Travel, string> = {
  walk: 'Balade',
  active: 'Aventure',
  motor: 'Expédition',
};

export const TRAVEL_HINTS: Record<Travel, string> = {
  walk: 'À pied, en toute détente : les lieux sont à quelques rues les uns des autres.',
  active: 'À pied d’un bon pas, à vélo ou en trottinette : un parcours plus étendu, sur plusieurs quartiers.',
  motor: 'En véhicule motorisé (moto, voiture…) : les étapes sont à plusieurs kilomètres, avec de quoi se garer.',
};

/** Moyen de déplacement, en deux mots (cartes du catalogue). */
export const TRAVEL_MEANS: Record<Travel, string> = {
  walk: 'À pied',
  active: 'Vélo, trottinette',
  motor: 'En véhicule',
};

/** Icônes Material Symbols du déplacement. */
export const TRAVEL_ICONS: Record<Travel, string> = {
  walk: 'directions_walk',
  active: 'directions_bike',
  motor: 'directions_car',
};

/** Durée lisible : « 45 min », « 1 h », « 2 h 30 ». */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const m = minutes % 60;
  return `${Math.floor(minutes / 60)} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

/** Difficulté des énigmes. */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Faciles',
  medium: 'Intermédiaires',
  hard: 'Corsées',
};

export const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: 'Énigmes directes, idéal en famille.',
  medium: 'Jeux de mots et devinettes imagées.',
  hard: 'Charades et allusions cryptiques pour aventuriers aguerris.',
};

/** Épreuves du générateur de démonstration : jouables sans rien observer sur place. */
export const DEMO_PUZZLES: Record<PuzzleType, Puzzle> = {
  question: { type: 'question', prompt: 'Combien de lettres compte le mot « expédition » ?', answer: '10|dix', hint: 'Comptez sur vos doigts.' },
  lock: { type: 'lock', prompt: 'Le cadenas s’ouvre sur l’année de la prise de la Bastille.', answer: '1789', hint: 'La Révolution française.' },
  cipher: { type: 'cipher', prompt: 'Un explorateur a laissé ce message chiffré : tournez la roue.', answer: 'le tresor est proche', hint: 'Décalage de 3.', shift: 3 },
  anagram: { type: 'anagram', prompt: 'Remettez les lettres dans l’ordre : l’instrument de tout explorateur.', answer: 'boussole', hint: 'Elle indique le nord.' },
  rebus: { type: 'rebus', prompt: '🐱 + ce qui recouvre votre corps = ce que porte l’explorateur sur la tête', answer: 'chapeau', hint: 'Chat + peau.' },
};

/**
 * Chasse de démonstration, sans réseau ni IA : quelques lieux fictifs en spirale autour
 * du point de départ. Sert aux maquettes et aux tests du serveur.
 */
export function demoPlan(center: { lat: number; lng: number }, count: number, placeName = 'la ville', puzzles: readonly PuzzleType[] = []): HuntPlan {
  const places = ['la vieille fontaine', 'la statue du fondateur', 'le cadran solaire', 'la porte aux lions', 'le belvédère', 'la chapelle oubliée'];
  const steps: PlannedStep[] = [
    {
      title: 'Départ',
      arrival: null,
      instructions: 'Là où l’eau chante sans jamais se taire, cherchez la première trace de l’expédition.',
      hints: ['Écoutez.', 'De l’eau qui coule, en pleine ville.', 'Une fontaine, tout près du départ.'],
      latitude: center.lat,
      longitude: center.lng,
      address: `Place centrale, ${placeName}`,
    },
  ];
  for (let i = 1; i <= count; i++) {
    const final = i === count;
    const angle = i * 2.1;
    // Le parcours s'éloigne puis revient : le trésor est tout près du rendez-vous (boucle, § 11.2).
    const dist = final ? 150 : 120 * Math.min(i, count - i); // mètres
    const place = places[(i - 1) % places.length];
    steps.push({
      title: final ? 'Le trésor' : place[0].toUpperCase() + place.slice(1),
      arrival: final ? 'Le trésor était là, sous vos yeux. Bravo, explorateur !' : `Bien joué : vous avez trouvé ${place}.`,
      instructions: final ? null : `Votre boussole pointe désormais vers ${places[i % places.length]} : en route !`,
      hints: final ? [] : ['Levez les yeux.', 'Ce n’est pas loin.', `Cherchez ${places[i % places.length]}.`],
      latitude: center.lat + (Math.sin(angle) * dist) / 111_195,
      longitude: center.lng + (Math.cos(angle) * dist) / (111_195 * Math.cos((center.lat * Math.PI) / 180)),
      address: null,
      // Une étape sur deux porte une épreuve, types permis à tour de rôle ; jamais le trésor.
      puzzle: !final && puzzles.length && i % 2 === 1 ? DEMO_PUZZLES[puzzles[((i - 1) / 2) % puzzles.length]] : null,
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
