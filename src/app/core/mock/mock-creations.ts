import {
  checkPackContent,
  checkSkinContent,
  Creation,
  CreationInput,
  CreationKind,
  creationProductId,
  creatorSkin,
  CreatorPage,
  PackContent,
  samePuzzle,
  SkinContent,
} from '@shared/creations';
import { StoreItem } from '@shared/models';
import { Puzzle } from '@shared/puzzles';
import { SkinManifest, skinById } from '@shared/skins';
import { ApiError } from '../api';

interface Row {
  id: number;
  kind: CreationKind;
  authorId: number;
  name: string;
  description: string;
  price: number;
  status: Creation['status'];
  note: string | null;
  content: SkinContent | PackContent;
  published: string | null;
  lastUpdate: string;
}

const check = (kind: CreationKind, content: unknown) => (kind === 'skin' ? checkSkinContent(content) : checkPackContent(content));
const now = () => new Date().toISOString();
const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>${body}</svg>`)}`;

/** Un skin de démo tiré d'un univers intégré, recoloré. */
function remix(base: string, tokens: SkinContent['tokens'], cover: string, scheme: 'light' | 'dark'): SkinContent {
  const b = skinById(base);
  return checkSkinContent({ scheme, tokens: { ...b.tokens, ...tokens }, fonts: b.fonts, cover, sounds: b.sounds, effects: b.effects }).content;
}

/**
 * Créations de la communauté pour la maquette (§ 19), mêmes règles que le serveur :
 * Camille a publié un skin et un pack ; Zoé attend une relecture (Seb est relecteur).
 */
export class MockCreations {
  private rows: Row[] = [];

  constructor(
    private readonly nick: (id: number) => string,
    private readonly purchases: Map<number, Set<string>>,
  ) {
    const t = '2026-09-20T10:00:00.000Z';
    const neon = remix(
      'spatial',
      {
        'page-bg': '#0b0b1a',
        primary: '#ff2e97',
        'primary-light': '#ff6ec4',
        secondary: '#29e6ff',
        accent: '#ffe45c',
        cta: '#ff2e97',
        'on-cta': '#ffffff',
        'heading-ink': '#29e6ff',
        'banner-title': '#ff6ec4',
        'surface-heading': '#29e6ff',
        'display-shadow': '0 0 14px rgba(255, 46, 151, 0.8)',
      },
      svg(
        `<rect width='320' height='180' fill='#0b0b1a'/><g fill='none' stroke-width='4'><path d='M20 140 H300' stroke='#29e6ff'/><path d='M60 140 V70 H110 V140 M150 140 V40 H200 V140 M240 140 V90 H280 V140' stroke='#ff2e97'/></g><circle cx='255' cy='45' r='16' fill='#ffe45c'/>`,
      ),
      'dark',
    );
    const aquarelle = remix(
      'epure',
      { 'page-bg': '#f4f1ea', primary: '#3f7d8c', 'primary-light': '#5ea3b3', accent: '#d98f6b', cta: '#3f7d8c', 'on-cta': '#ffffff' },
      svg(`<rect width='320' height='180' fill='#f4f1ea'/><circle cx='110' cy='90' r='60' fill='#5ea3b3' opacity='.45'/><circle cx='190' cy='80' r='50' fill='#d98f6b' opacity='.45'/><circle cx='160' cy='120' r='40' fill='#9cc58a' opacity='.45'/>`),
      'light',
    );
    const mers: PackContent = {
      puzzles: [
        { type: 'anagram', prompt: 'Remettez les lettres dans l’ordre : celui qui tient la barre.', answer: 'navigateur', hint: 'Il trace la route du navire.' },
        { type: 'cipher', prompt: 'La vigie a griffonné ce message chiffré.', answer: 'terre en vue', hint: 'Décalage de 5.', shift: 5 },
        { type: 'rebus', prompt: '🐱 + 🧢 → ce que porte le capitaine', answer: 'chapeau', hint: 'Chat + peau.' },
        { type: 'lock', prompt: 'Le coffre s’ouvre sur l’année où Colomb atteignit les Amériques.', answer: '1492', hint: 'Fin du XVᵉ siècle.' },
      ],
    };
    this.rows = [
      { id: 1, kind: 'skin', authorId: 2, name: 'Néon', description: 'Une ville la nuit : enseignes roses, reflets cyan, pour les chasses nocturnes.', price: 199, status: 'published', note: null, content: neon, published: t, lastUpdate: t },
      { id: 2, kind: 'pack', authorId: 2, name: 'Mers du Sud', description: 'Quatre énigmes de marins, prêtes à poser sur vos étapes.', price: 299, status: 'published', note: null, content: mers, published: t, lastUpdate: t },
      { id: 3, kind: 'skin', authorId: 9, name: 'Aquarelle', description: 'Des taches de couleur douces, comme un carnet de voyage peint.', price: 0, status: 'review', note: null, content: aquarelle, published: null, lastUpdate: t },
    ];
  }

  private view(r: Row, full: boolean): Creation {
    const puzzles = r.kind === 'pack' ? (r.content as PackContent).puzzles : [];
    return {
      id: r.id,
      kind: r.kind,
      authorId: r.authorId,
      authorNickname: this.nick(r.authorId),
      name: r.name,
      description: r.description,
      price: r.price,
      status: r.status,
      note: r.note,
      content: full || r.kind === 'skin' ? r.content : { puzzles: [] },
      cover: r.kind === 'skin' ? (r.content as SkinContent).cover : null,
      puzzleCount: puzzles.length,
      published: r.published,
      lastUpdate: r.lastUpdate,
      problems: full ? check(r.kind, r.content).problems : [],
    };
  }

  private own(me: number, id: number): Row {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.authorId !== me) throw new ApiError('Création introuvable.');
    return r;
  }

  published(id: number): Row | undefined {
    return this.rows.find((r) => r.id === id && r.status === 'published');
  }

  products(me: number | null): StoreItem[] {
    const owned = (me !== null && this.purchases.get(me)) || new Set<string>();
    return this.rows
      .filter((r) => r.status === 'published')
      .map((r) => {
        const c = this.view(r, false);
        const id = creationProductId(c.kind, c.id);
        return {
          id,
          kind: c.kind,
          ref: `u${c.id}`,
          name: c.name,
          description: c.description,
          price: c.price,
          included: false,
          cover: c.cover,
          icon: c.kind === 'pack' ? 'extension' : null,
          owned: owned.has(id) || c.authorId === me,
          creator: { id: c.authorId, nickname: c.authorNickname },
          ...(c.kind === 'skin' ? { skin: creatorSkin(c, c.content as SkinContent) } : { puzzleCount: c.puzzleCount }),
        };
      });
  }

  mine(me: number): Creation[] {
    return this.rows.filter((r) => r.authorId === me).map((r) => this.view(r, true));
  }

  create(me: number, input: CreationInput): Creation {
    const { content, problems } = check(input.kind, input.content);
    const r: Row = { id: Math.max(0, ...this.rows.map((x) => x.id)) + 1, kind: input.kind, authorId: me, name: input.name.trim(), description: input.description.trim(), price: input.price, status: 'draft', note: null, content, published: null, lastUpdate: now() };
    this.rows.push(r);
    return { ...this.view(r, true), problems };
  }

  update(me: number, id: number, input: Partial<Omit<CreationInput, 'kind'>>): Creation {
    const r = this.own(me, id);
    if (r.status === 'review') throw new ApiError('Cette création est en relecture : retirez-la de la relecture pour la modifier.');
    if (r.status === 'published') throw new ApiError('Une création publiée ne se modifie plus : proposez-en une nouvelle version.');
    const checked = input.content !== undefined ? check(r.kind, input.content) : null;
    Object.assign(r, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(checked ? { content: checked.content } : {}),
      status: 'draft',
      lastUpdate: now(),
    });
    const saved = this.view(r, true);
    return checked ? { ...saved, problems: checked.problems } : saved;
  }

  remove(me: number, id: number): void {
    const r = this.own(me, id);
    if (r.status === 'published') throw new ApiError('Une création publiée reste disponible pour ceux qui l’ont obtenue.');
    this.rows = this.rows.filter((x) => x !== r);
  }

  submit(me: number, id: number): Creation {
    const r = this.own(me, id);
    if (r.status !== 'draft' && r.status !== 'rejected') throw new ApiError('Cette création est déjà en relecture ou publiée.');
    const problems = check(r.kind, r.content).problems;
    if (!r.name) problems.unshift('Donnez un nom à votre création.');
    if (problems.length) throw new ApiError(problems.join(' '));
    Object.assign(r, { status: 'review', note: null, lastUpdate: now() });
    return this.view(r, true);
  }

  withdraw(me: number, id: number): Creation {
    const r = this.own(me, id);
    if (r.status !== 'review') throw new ApiError('Cette création n’est pas en relecture.');
    Object.assign(r, { status: 'draft', lastUpdate: now() });
    return this.view(r, true);
  }

  queue(reviewer: boolean): Creation[] {
    if (!reviewer) throw new ApiError('Réservé aux relecteurs.');
    return this.rows.filter((r) => r.status === 'review').map((r) => this.view(r, true));
  }

  review(me: number, reviewer: boolean, id: number, approve: boolean, note: string | null): Creation {
    if (!reviewer) throw new ApiError('Réservé aux relecteurs.');
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new ApiError('Création introuvable.');
    if (r.status !== 'review') throw new ApiError('Cette création n’attend pas de relecture.');
    if (r.authorId === me) throw new ApiError('On ne relit pas ses propres créations.');
    if (!approve && !note?.trim()) throw new ApiError('Dites au créateur ce qu’il doit corriger.');
    Object.assign(r, { status: approve ? 'published' : 'rejected', note: note?.trim() || null, published: approve ? now() : null, lastUpdate: now() });
    return this.view(r, true);
  }

  creator(id: number, exists: boolean): CreatorPage {
    if (!exists) throw new ApiError('Créateur introuvable.');
    return { id, nickname: this.nick(id), creations: this.rows.filter((r) => r.authorId === id && r.status === 'published').map((r) => this.view(r, false)) };
  }

  skin(id: string): SkinManifest {
    const r = this.published(Number(id.slice(1)));
    if (!r || r.kind !== 'skin' || !/^u\d+$/.test(id)) throw new ApiError('Skin introuvable.');
    const c = this.view(r, false);
    return creatorSkin(c, c.content as SkinContent);
  }

  fromOwnedPack(owned: ReadonlySet<string>, puzzle: Puzzle): boolean {
    return this.rows.some((r) => r.kind === 'pack' && r.status === 'published' && owned.has(creationProductId('pack', r.id)) && (r.content as PackContent).puzzles.some((p) => samePuzzle(p, puzzle)));
  }

  puzzles(me: number, reviewer: boolean, id: number): Puzzle[] {
    const r = this.rows.find((x) => x.id === id && x.kind === 'pack');
    if (!r) throw new ApiError('Pack introuvable.');
    const allowed = r.authorId === me || (r.status === 'published' && !!this.purchases.get(me)?.has(creationProductId('pack', id))) || reviewer;
    if (!allowed) throw new ApiError('Obtenez d’abord ce pack dans la boutique.');
    return (r.content as PackContent).puzzles;
  }
}
