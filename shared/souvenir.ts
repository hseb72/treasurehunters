/**
 * Tracé du souvenir (§ 24) : les lieux dans l'ordre du parcours, projetés à plat puis
 * ramenés dans le carré [0, 1] en gardant les proportions. Ce n'est qu'une forme : ni fond
 * de carte ni coordonnées, pour ne rien dévoiler du parcours à ceux qui verront l'image.
 */
export function sketchTrail(points: { lat: number; lng: number }[]): [number, number][] {
  if (!points.length) return [];
  const meanLat = (points.reduce((a, p) => a + p.lat, 0) / points.length) * (Math.PI / 180);
  const flat = points.map((p) => [p.lng * Math.cos(meanLat), -p.lat] as const);
  const xs = flat.map((p) => p[0]);
  const ys = flat.map((p) => p[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  const size = Math.max(w, h);
  if (size === 0) return points.map(() => [0.5, 0.5]);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return flat.map(([x, y]) => [round((x - minX) / size + (1 - w / size) / 2), round((y - minY) / size + (1 - h / size) / 2)]);
}
