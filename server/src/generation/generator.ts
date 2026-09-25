/**
 * Invention d'une chasse à partir des souhaits du joueur (§ 11) :
 * lieu → lieux réels (OpenStreetMap) → parcours et énigmes (Claude).
 */
import { demoPlan, HuntPlan, plannedStepCount, searchRadius } from '../../../shared/generation.js';
import { GenerationRequest } from '../../../shared/models.js';
import { distanceMeters } from '../../../shared/rules.js';
import { HttpError } from '../errors.js';
import { ClaudePlanner } from './claude.js';
import { geocode, placesAround, Place, Poi, reverseGeocode } from './osm.js';

export interface GeneratedHunt {
  plan: HuntPlan;
  /** Nom du lieu, pour le champ « lieu » de la chasse. */
  location: string;
}

export interface HuntGenerator {
  generate(req: GenerationRequest): Promise<GeneratedHunt>;
}

/** Au-delà, la liste envoyée au modèle serait inutilement longue. */
const MAX_CANDIDATES = 60;

export class OsmClaudeGenerator implements HuntGenerator {
  private readonly planner: ClaudePlanner;

  constructor(apiKey: string) {
    this.planner = new ClaudePlanner(apiKey);
  }

  async generate(req: GenerationRequest): Promise<GeneratedHunt> {
    const place = await locate(req);
    const count = plannedStepCount(req);
    const pois = await this.candidates(place, req.durationMinutes, count);
    const plan = await this.planner.plan({
      placeName: place.name,
      center: place,
      pois,
      count,
      difficulty: req.difficulty,
      durationMinutes: req.durationMinutes,
    });
    return { plan, location: place.name };
  }

  /**
   * Lieux candidats : une seule requête Overpass, au double du rayon visé (les instances
   * publiques limitent le débit), puis les lieux du rayon visé s'ils suffisent.
   */
  private async candidates(center: Place, duration: number, count: number): Promise<Poi[]> {
    const radius = searchRadius(duration);
    // Plafonné : au-delà de 3 km, une ville dense fait expirer la requête Overpass.
    const all = await placesAround(center, Math.min(radius * 2, 3000));
    const near = all.filter((p) => distanceMeters(center, p) <= radius);
    const pois = near.length >= count + 2 ? near : all;
    if (pois.length < count) {
      throw new HttpError(422, 'Pas assez de lieux remarquables autour de ce point : allongez la durée, réduisez le nombre d’étapes ou choisissez un autre lieu.');
    }
    // Les plus proches, en privilégiant ceux qui ont de quoi nourrir une énigme.
    return pois
      .slice(0, MAX_CANDIDATES * 2)
      .map((p, rank) => ({ p, score: rank - 8 * Object.keys(p.details).length }))
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_CANDIDATES)
      .map(({ p }) => p);
  }
}

async function locate(req: GenerationRequest): Promise<Place> {
  const { lat, lng, query } = req.location;
  if (lat !== undefined && lng !== undefined) {
    const place = await reverseGeocode(lat, lng);
    return query?.trim() ? { ...place, name: query.trim() } : place;
  }
  if (query?.trim()) return geocode(query.trim());
  throw new HttpError(400, 'Indiquez un lieu : une ville, un point sur la carte ou votre position.');
}

/** Générateur sans réseau (tests, démonstration) : lieux fictifs en spirale autour du point. */
export class DemoGenerator implements HuntGenerator {
  async generate(req: GenerationRequest): Promise<GeneratedHunt> {
    const { lat = 43.6085, lng = 3.8795, query } = req.location;
    const location = query?.trim() || 'les environs';
    return { plan: demoPlan({ lat, lng }, plannedStepCount(req), location), location };
  }
}
