/** `ng serve` : API locale (proxy /api → http://localhost:3000) avec le jeu de démonstration. */
export const environment = {
  api: 'http' as 'http' | 'mock',
  apiUrl: '/api',
  demo: true,
};
