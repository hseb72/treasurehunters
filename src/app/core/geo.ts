/** Position du téléphone, avec des messages d'erreur compréhensibles. */
export interface Position {
  lat: number;
  lng: number;
  /** Précision annoncée par l'appareil, en mètres. */
  accuracy: number;
}

export function currentPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Votre appareil ne sait pas donner sa position.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Autorisez la localisation pour ce site dans les réglages du navigateur.'
              : 'Position introuvable : sortez à découvert et réessayez.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}
