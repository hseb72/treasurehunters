/**
 * Jeu de données des maquettes. Les dates sont calculées par rapport à l'heure de chargement,
 * pour que la chasse « en cours » le soit toujours.
 */
import { HintUse, Hunt, Hunter, Step, Team, Validation } from '../models';

export interface MockDb {
  hunters: (Hunter & { password: string })[];
  hunts: Omit<Hunt, 'stepCount' | 'teamCount' | 'ownerNickname'>[];
  steps: Step[];
  teams: Team[];
  validations: Validation[];
  hintUses: HintUse[];
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Jetons stables pour pouvoir partager des liens de démonstration. */
export const DEMO_TOKENS = {
  nefles: ['', 'nF3kq9ZtLm2Xv8Rw1YbC0d', 'Pq7Hs2Wd9KxB4mT6yLc1Ze', 'Gv5Jr8Nf2QaD7wS3hUk0Xp', 'Yt1Bm6Ce4Rz9Lp2Vs8Hq5W', 'Ka9Xd3Fw7Jn2Tq5Mb8Rg1S'],
  lez: ['', 'Lz4Qe8Wr2Ty6Ui0Op3As7D', 'Df5Gh9Jk3Lz7Xc1Vb5Nm0Q', 'Wx2Ec6Rv0Tb4Yn8Um2Ik6O', 'Pl3Ok7Ij1Uh5Yg9Tf3Rd7E'],
  palavas: ['', 'Mn8Bv4Cx0Za6Sd2Fg8Hj4K', 'Qw9Er5Ty1Ui7Op3As9Df5G', 'Hj6Kl2Zx8Cv4Bn0Mq6We2R'],
  ecusson: ['', 'Rt7Yu3Io9Pa5Sd1Fg7Hj3K', 'Lz0Xc6Vb2Nm8Qw4Er0Ty6U'],
  etangs: ['', 'Ui5Op1As7Df3Gh9Jk5Lz1X', 'Cv8Bn4Mq0We6Rt2Yu8Io4P'],
};

export function buildFixtures(now = Date.now()): MockDb {
  const at = (offsetMin: number) => new Date(now + offsetMin * MIN).toISOString();
  const atDay = (days: number, hour: number, minute = 0) => {
    const d = new Date(now + days * DAY);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  const hunters: MockDb['hunters'] = [
    { id: 1, nickname: 'seb', email: 'seb@example.com', password: 'demo' },
    { id: 2, nickname: 'Camille', email: 'camille@example.com', password: 'demo' },
    ...['Léa', 'Hugo', 'Inès', 'Tom', 'Jade', 'Noah', 'Zoé', 'Enzo', 'Manon', 'Lucas', 'Chloé', 'Nathan', 'Emma', 'Louis'].map(
      (nickname, i) => ({ id: i + 3, nickname, email: `${nickname.toLowerCase()}@example.com`, password: 'demo' }),
    ),
  ];
  const nick = (id: number) => hunters.find((h) => h.id === id)!.nickname;
  const members = (...ids: number[]) => ids.map((hunterId) => ({ hunterId, nickname: nick(hunterId) }));

  const baseHunt = {
    autoStart: false,
    autoClose: false,
    award: null,
    interval: null,
    hintPenalty: 0,
    teamGame: true,
    teamMin: 1,
    teamMax: 4,
    isPublic: true,
    contribution: 0,
    startText: null,
    started: null,
    closed: null,
  } as const;

  const nefStart = -95;
  const hunts: MockDb['hunts'] = [
    {
      ...baseHunt,
      id: 1,
      ownerId: 2,
      name: 'Le Trésor des Nèfles',
      description:
        "Un rallye à travers Lattes, du port Ariane au site archéologique de Lattara. Cinq étapes, des énigmes pour petits et grands, et un trésor gourmand à l'arrivée.",
      location: '34970 Lattes',
      begin: at(nefStart),
      end: at(180),
      started: at(nefStart),
      award: 'Un panier de nèfles et la gloire éternelle',
      startMode: 'staggered',
      interval: 10,
      hintPenalty: 5,
      teamMin: 2,
      joinCode: 'NEFLES',
      contribution: 5,
      startText: 'Rendez-vous devant la mairie. Chaque équipe part à son heure : gardez un œil sur votre téléphone !',
      status: 'running',
    },
    {
      ...baseHunt,
      id: 2,
      ownerId: 2,
      name: 'Rallye du Lez',
      description: "Remontez le Lez à la recherche des indices laissés par un meunier du XVIIIᵉ siècle. Départ groupé, premier arrivé, premier servi !",
      location: 'Montpellier — Lez',
      begin: atDay(3, 14),
      end: atDay(3, 18),
      award: 'Coupe et bons d’achat chez le glacier',
      startMode: 'mass',
      joinCode: 'LEZ2026',
      status: 'published',
    },
    {
      ...baseHunt,
      id: 3,
      ownerId: 2,
      name: "Chasse d'été à Palavas",
      description: 'Une chasse les pieds dans le sable, entre le phare de la Méditerranée et les canaux.',
      location: '34250 Palavas-les-Flots',
      begin: atDay(-60, 10),
      end: atDay(-60, 13),
      started: atDay(-60, 10),
      closed: atDay(-60, 13),
      award: 'Un plateau de fruits de mer',
      startMode: 'mass',
      hintPenalty: 3,
      joinCode: 'PALAVAS',
      status: 'closed',
    },
    {
      ...baseHunt,
      id: 4,
      ownerId: 1,
      name: "Mystères de l'Écusson",
      description: 'Les ruelles du centre historique de Montpellier cachent des secrets…',
      location: 'Montpellier — Écusson',
      begin: atDay(20, 9, 30),
      end: atDay(20, 12, 30),
      startMode: 'staggered',
      interval: 15,
      isPublic: false,
      joinCode: 'ECUSSON',
      status: 'draft',
    },
    {
      ...baseHunt,
      id: 5,
      ownerId: 2,
      name: 'Balade des Étangs',
      description: 'Une chasse en solo, à pied ou à vélo, autour des étangs de Méjean et du Méjean.',
      location: '34970 Lattes — Méjean',
      begin: atDay(10, 9),
      end: atDay(10, 17),
      award: 'Des jumelles d’observation',
      startMode: 'mass',
      teamGame: false,
      teamMax: 1,
      joinCode: 'ETANGS',
      status: 'published',
    },
  ];

  let stepId = 0;
  const steps: Step[] = [];
  const addSteps = (huntId: number, tokens: string[], list: [string, string | null, string | null, string[], string | null][]) =>
    list.forEach(([title, arrival, instructions, hints, address], order) =>
      steps.push({
        id: ++stepId,
        huntId,
        order,
        token: order === 0 ? null : tokens[order],
        title,
        arrival,
        instructions,
        hints,
        answer: null,
        latitude: null,
        longitude: null,
        address,
      }),
    );

  addSteps(1, DEMO_TOKENS.nefles, [
    [
      'Départ',
      null,
      "Là où les bateaux dorment sans jamais prendre la mer, cherchez la capitainerie. Le QR vous attend à hauteur d'enfant.",
      ['Nous sommes à Lattes : quel port porte le nom d’une princesse crétoise ?', 'Port Ariane, côté capitainerie.'],
      'Mairie de Lattes',
    ],
    [
      'Port Ariane — capitainerie',
      'Bravo, vous voici au port Ariane ! Ariane aidait Thésée à sortir du labyrinthe… vous, vous devez y entrer.',
      'Prenez le pont et comptez ses arches. Rendez-vous là où les livres sont rangés par milliers, sous le numéro égal à ce compte.',
      ['Le pont a 3 arches.', 'Cherchez un bâtiment culturel, tout proche.', 'La médiathèque Shakespeare, casier 3.'],
      'Port Ariane, 34970 Lattes',
    ],
    [
      'Médiathèque',
      'Vous avez trouvé la médiathèque. Silence, on cherche !',
      "« Je suis vert l'été, roux l'automne, et je donne mon nom à un parc où l'on joue à la pétanque. » Trouvez-moi, le QR est sous le banc du boulodrome.",
      ['Ce n’est pas un chêne.', 'Pensez au domaine de Méric.', 'Parc Méric, boulodrome.'],
      'Médiathèque Shakespeare',
    ],
    [
      'Parc Méric — boulodrome',
      'Carreau ! Vous êtes au parc Méric.',
      'Il y a 2 000 ans, un port antique commerçait ici avec les Étrusques. Rendez-vous à son entrée.',
      ['Lattara.', 'Le site archéologique, près du musée Henri Prades.'],
      'Parc Méric',
    ],
    [
      'Site archéologique Lattara',
      'Les Étrusques vous saluent : vous êtes à Lattara.',
      'Dernière étape : revenez là où tout a commencé, mais cette fois-ci par la porte de derrière.',
      ['Vous êtes parti de la mairie.', 'Entrée arrière de la mairie, côté parking.'],
      'Musée Henri Prades',
    ],
    ['Arrivée — mairie', 'Félicitations, vous avez trouvé le trésor : des nèfles pour tout le monde ! Présentez-vous à l’organisatrice.', null, [], 'Mairie de Lattes'],
  ]);

  addSteps(2, DEMO_TOKENS.lez, [
    ['Départ', null, 'Le meunier a laissé son premier message près de la chaussée du moulin de l’Évêque.', ['Moulin de l’Évêque.'], null],
    ['Moulin de l’Évêque', 'Bienvenue au moulin !', 'Suivez le courant jusqu’au pont où passe le tram.', [], null],
    ['Pont du tram', 'Bien joué.', 'Cherchez l’arbre le plus vieux du parc voisin.', [], null],
    ['Parc de Lunaret', 'Bravo.', 'Retour au point de départ, par l’autre rive.', [], null],
    ['Arrivée', 'Vous avez rattrapé le meunier ! Bravo.', null, [], null],
  ]);

  addSteps(3, DEMO_TOKENS.palavas, [
    ['Départ', null, 'Montez au sommet du phare de la Méditerranée.', ['Il tourne… mais c’est un restaurant.'], null],
    ['Phare de la Méditerranée', 'Belle vue, non ?', 'Longez le canal jusqu’à la redoute de Ballestras.', [], null],
    ['Redoute de Ballestras', 'Presque fini.', 'Le trésor est enterré sous le plus grand parasol de la plage.', [], null],
    ['Arrivée — plage', 'Le trésor est à vous !', null, [], null],
  ]);

  addSteps(4, DEMO_TOKENS.ecusson, [
    ['Départ', null, 'Rendez-vous sous les trois Grâces.', ['Place de la Comédie.'], 'Place de la Comédie'],
    ['Place de la Comédie', 'Vous êtes place de la Comédie.', 'Cherchez l’arc qui célèbre le Roi-Soleil.', ['Arc de triomphe du Peyrou.'], 'Place de la Comédie'],
    ['Arrivée — Peyrou', 'Bravo !', null, [], 'Promenade du Peyrou'],
  ]);

  addSteps(5, DEMO_TOKENS.etangs, [
    ['Départ', null, 'Suivez le sentier jusqu’à l’observatoire des flamants.', [], null],
    ['Observatoire', 'Des flamants roses !', 'Retournez au parking par la digue.', [], null],
    ['Arrivée', 'Fin de la balade !', null, [], null],
  ]);

  const stepOf = (huntId: number, order: number) => steps.find((s) => s.huntId === huntId && s.order === order)!.id;

  const teams: Team[] = [];
  const validations: Validation[] = [];
  const hintUses: HintUse[] = [];
  let teamId = 0;
  const addTeam = (
    huntId: number,
    name: string,
    memberIds: number[],
    opts: { startOrder?: number; started?: string | null; passes?: number[]; hints?: [number, number][]; solo?: boolean } = {},
  ) => {
    const id = ++teamId;
    const hunt = hunts.find((h) => h.id === huntId)!;
    const passes = opts.passes ?? [];
    // Pour les chasses déjà démarrées, les passages sont en minutes par rapport au départ de la chasse.
    const origin = hunt.started ? Date.parse(hunt.started) : now;
    const final = steps.filter((s) => s.huntId === huntId).length - 1;
    passes.forEach((p, i) =>
      validations.push({
        teamId: id,
        stepId: stepOf(huntId, i + 1),
        hunterId: memberIds[i % memberIds.length],
        source: 'QR',
        at: new Date(origin + p * MIN).toISOString(),
      }),
    );
    (opts.hints ?? []).forEach(([order, level], i) =>
      hintUses.push({ teamId: id, stepId: stepOf(huntId, order), level, hunterId: memberIds[0], at: new Date(origin + i * MIN).toISOString() }),
    );
    teams.push({
      id,
      huntId,
      name,
      ownerId: memberIds[0],
      joinCode: `${name.replace(/[^A-Za-z]/g, '').slice(0, 5).toUpperCase()}${id}`,
      solo: opts.solo ?? false,
      startOrder: opts.startOrder ?? null,
      started: opts.started ?? null,
      finished: passes.length === final ? new Date(origin + passes[passes.length - 1] * MIN).toISOString() : null,
      members: members(...memberIds),
    });
  };

  // Chasse 1 — en cours, départs échelonnés toutes les 10 min depuis le déclenchement (il y a 95 min).
  const t = (order: number) => at(nefStart + (order - 1) * 10);
  addTeam(1, 'Les Flibustiers', [5, 6], { startOrder: 1, started: t(1), passes: [15, 30, 45, 60, 73], hints: [[1, 1], [3, 1]] });
  addTeam(1, 'Team Boussole', [7, 8, 9], { startOrder: 2, started: t(2), passes: [28, 42, 55, 70, 85] });
  addTeam(1, 'Les Nèfles Masquées', [1, 3, 4], { startOrder: 3, started: t(3), passes: [35, 57], hints: [[1, 1]] });
  addTeam(1, 'Les Mouettes', [10, 11], { startOrder: 4, started: t(4), passes: [48, 62, 80] });
  addTeam(1, 'Cap au Sud', [12, 13], { startOrder: 5, started: t(5), passes: [70], hints: [[0, 1], [0, 2]] });
  addTeam(1, 'Les Retardataires', [14, 15], { startOrder: 6, started: t(6) });

  // Chasse 2 — publiée, pas encore commencée.
  addTeam(2, 'Les Nèfles Masquées', [1, 3]);
  addTeam(2, 'Les Castors du Lez', [5, 7, 9]);
  addTeam(2, 'Pagaie Team', [10, 12]);

  // Chasse 3 — close, avec podium (départ groupé).
  const p3 = hunts[2].started!;
  addTeam(3, 'Les Crabes Rieurs', [1, 4], { started: p3, passes: [30, 70, 102], hints: [[1, 1]] });
  addTeam(3, 'Les Goélands', [5, 6, 7], { started: p3, passes: [25, 60, 98], hints: [[0, 1], [1, 1]] });
  addTeam(3, 'Sable Chaud', [8, 9], { started: p3, passes: [35, 80, 110] });
  addTeam(3, 'Les Méduses', [10, 11, 12], { started: p3, passes: [40, 95] });
  addTeam(3, 'Marée Basse', [13, 14], { started: p3, passes: [55] });

  // Chasse 5 — solo, publiée.
  [3, 5, 8].forEach((id) => addTeam(5, nick(id), [id], { solo: true }));

  return { hunters, hunts, steps, teams, validations, hintUses };
}
