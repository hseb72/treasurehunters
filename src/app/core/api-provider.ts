import { HttpHuntApi } from './http-hunt-api';

/**
 * Implémentation de l'API : le vrai back-end. La configuration « mock » (maquettes) remplace
 * ce fichier par api-provider.mock.ts : le back-end simulé n'est ainsi jamais embarqué en production.
 */
export const HUNT_API_CLASS = HttpHuntApi;
