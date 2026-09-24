/** `npm run start:mock` / `build:mock` : maquettes autonomes, sans back-end. */
export const environment = {
  api: 'mock' as 'http' | 'mock',
  apiUrl: '/api',
  demo: true,
};
