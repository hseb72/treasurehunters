/** Configuration par défaut : front branché sur l'API (voir environment.mock.ts pour les maquettes). */
export const environment = {
  /** 'http' = vrai back-end, 'mock' = données simulées dans le navigateur. */
  api: 'http' as 'http' | 'mock',
  apiUrl: '/api',
  /** Affiche le guide des maquettes et les comptes de démonstration. */
  demo: false,
};
