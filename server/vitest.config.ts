import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts', '../shared/**/*.spec.ts'],
    // Les tests d'intégration partagent une base PostgreSQL : pas de parallélisme entre fichiers.
    fileParallelism: false,
  },
});
