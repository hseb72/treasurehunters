/**
 * Invention d'une chasse à partir des souhaits du joueur (§ 11) :
 * lieu → lieux réels (OpenStreetMap) → parcours et énigmes (Claude).
 */
import { demoPlan, HuntPlan, plannedStepCount, searchRadius } from '../../../shared/generation.js';
import { GenerationRequest, Travel } from '../../../shared/models.js';
import { distanceMeters } from '../../../shared/rules.js';
import { HttpError } from '../errors.js';
import { ClaudePlanner } from './claude.js';
import { Access, accessOf, geocode, placesAround, Place, Poi, reverseGeocode, ThemeFilter } from './osm.js';

export interface GeneratedHunt {
  plan: HuntPlan;
  /** Nom du lieu, pour le champ « lieu » de la chasse. */
  location: string;
  /** Comment le thème demandé a été suivi (null sans thème). */
  note?: string | null;
}

export interface HuntGenerator {
  generate(req: GenerationRequest): Promise<GeneratedHunt>;
}

/** Au-delà, la liste envoyée au modèle serait inutilement longue. */
const MAX_CANDIDATES = 60;

/**
 * Zone interrogée : un peu plus large que le rayon visé, pour avoir le choix. Plafonnée :
 * à pied, au-delà de 3 km une ville dense fait expirer Overpass ; sur les grandes zones, la
 * requête ne ramène que les lieux marquants (voir placesAround).
 */
const SEARCH_AREA: Record<Travel, { factor: number; max: number }> = {
  walk: { factor: 2, max: 3000 },
  active: { factor: 1.5, max: 8000 },
  motor: { factor: 1.2, max: 30000 },
};

export class OsmClaudeGenerator implements HuntGenerator {
  private readonly planner: ClaudePlanner;

  constructor(apiKey: string) {
    this.planner = new ClaudePlanner(apiKey);
  }

  /** Voir ClaudePlanner.check. */
  check(): Promise<void> {
    return this.planner.check();
  }

  async generate(req: GenerationRequest): Promise<GeneratedHunt> {
    const place = await locate(req);
    const count = plannedStepCount(req);
    const theme = req.theme?.trim() || null;
    // Un thème que l'IA ne sait pas traduire en lieux se contente de guider la rédaction.
    const filters = theme ? await this.planner.themeFilters(theme).catch((): ThemeFilter[] => []) : [];
    const pois = await this.candidates(place, req, count, filters);
    const { plan, note } = await this.planner.plan({
      placeName: place.name,
      center: place,
      pois,
      count,
      travel: req.travel,
      difficulty: req.difficulty,
      durationMinutes: req.durationMinutes,
      theme,
    });
    // Parcs, musées, églises… : l'étape se valide depuis leurs entrées, pour rester jouable
    // quand ils sont fermés. Sans réponse d'Overpass, l'étape garde le point du lieu.
    const chosen = new Set(plan.steps.map((s) => s.source));
    const gated = pois.filter((p) => p.gated && chosen.has(p.id));
    const access = gated.length ? await accessOf(gated).catch(() => new Map<string, Access>()) : new Map<string, Access>();
    return { plan: placeAtEntrances(plan, access), location: place.name, note };
  }

  /**
   * Lieux candidats : une seule requête Overpass, un peu au-delà du rayon visé (les instances
   * publiques limitent le débit), puis les lieux du rayon visé s'ils suffisent. Ceux du thème
   * passent en premier.
   */
  private async candidates(center: Place, req: GenerationRequest, count: number, theme: ThemeFilter[]): Promise<Poi[]> {
    const radius = searchRadius(req.durationMinutes, req.travel);
    const area = SEARCH_AREA[req.travel];
    const all = await placesAround(center, Math.min(Math.round(radius * area.factor), area.max), theme);
    const near = all.filter((p) => distanceMeters(center, p) <= radius);
    const pois = near.length >= count + 2 ? near : all;
    // Un lieu de plus : le rendez-vous.
    if (pois.length < count + 1) {
      throw new HttpError(422, 'Pas assez de lieux remarquables autour de ce point : allongez la durée, réduisez le nombre d’étapes ou choisissez un autre lieu.');
    }
    // Les plus proches, en privilégiant ceux du thème puis ceux qui ont de quoi nourrir une énigme.
    return pois
      .slice(0, MAX_CANDIDATES * 3)
      .map((p, rank) => ({ p, score: rank - 8 * Object.keys(p.details).length - (p.themed ? 1000 : 0) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_CANDIDATES)
      .map(({ p }) => p);
  }
}

/**
 * Place chaque étape d'un lieu clos sur l'entrée la plus proche du lieu précédent (celle par
 * laquelle on arrive), les autres entrées restant valables. Le départ prend l'entrée la plus
 * proche de la première étape.
 */
export function placeAtEntrances(plan: HuntPlan, access: Map<string, Access>): HuntPlan {
  const steps = plan.steps.map((s) => ({ ...s }));
  steps.forEach((step, i) => {
    const a = step.source ? access.get(step.source) : undefined;
    const from = i === 0 ? steps[1] : steps[i - 1];
    if (!a?.points.length || !from) return;
    const origin = { lat: from.latitude, lng: from.longitude };
    const [nearest, ...others] = [...a.points].sort((p, q) => distanceMeters(origin, p) - distanceMeters(origin, q));
    step.latitude = nearest.lat;
    step.longitude = nearest.lng;
    step.entrances = others;
  });
  return { ...plan, steps };
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
    const note = req.theme?.trim() ? `Thème « ${req.theme.trim()} » : le générateur de démonstration ne cherche pas de vrais lieux, il ne l’a pas suivi.` : null;
    return { plan: demoPlan({ lat, lng }, plannedStepCount(req), location), location, note };
  }
}
