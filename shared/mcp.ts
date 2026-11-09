/**
 * Usage du serveur MCP du catalogue (docs/conception.md § 50) : de quoi juger s'il sert, avant
 * d'aller plus loin (connexion OAuth, outils des auteurs).
 */
export interface McpToolStats {
  tool: string;
  /** Appels sur 7 et 30 jours. */
  calls7: number;
  calls30: number;
  /** Appels sans résultat (recherche vide, Surprends-moi sans idée), sur 30 jours. */
  empty30: number;
  /** Appels en erreur, sur 30 jours. */
  errors30: number;
}

export interface McpStats {
  tools: McpToolStats[];
  /** Fiches ouvertes depuis un lien donné par un assistant (« ?via=mcp »). */
  visits7: number;
  visits30: number;
  /** Les fiches les plus ouvertes ainsi, sur 30 jours. */
  topVisited: { catalogId: number; title: string; visits: number }[];
  /** Appels par jour sur 30 jours, du plus ancien au plus récent. */
  daily: { day: string; calls: number; visits: number }[];
}

/** Marque des liens donnés aux assistants : la fiche ouverte ainsi compte une visite. */
export const MCP_VIA = 'mcp';
