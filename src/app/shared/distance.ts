/** « à 650 m », « à 1,2 km », « à 14 km » : distance à vol d'oiseau jusqu'au départ. */
export function distanceLabel(km: number): string {
  if (km < 1) return `à ${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  return `à ${km < 10 ? km.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : Math.round(km)} km`;
}
