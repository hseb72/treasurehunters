/**
 * Créations de la communauté (§ 19) : un créateur propose un skin ou un pack d'énigmes,
 * un relecteur le publie ou le refuse, les joueurs l'obtiennent dans la boutique.
 */
import pg from 'pg';
import {
  checkPackContent,
  checkSkinContent,
  Creation,
  CreationInput,
  CreationKind,
  CreatorPage,
  creationProductId,
  creatorSkin,
  PackContent,
  SkinContent,
} from '../../shared/creations.js';
import { StoreItem } from '../../shared/models.js';
import { Puzzle } from '../../shared/puzzles.js';
import { SkinManifest } from '../../shared/skins.js';
import { Db, one, Row, rows } from './db.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from './errors.js';

type Viewer = number | null;


const SELECT = 'SELECT c.*, u.htr_nickname FROM th_creations c JOIN th_hunters u ON u.htr_id = c.cre_author_htr';

function check(kind: CreationKind, content: unknown) {
  return kind === 'skin' ? checkSkinContent(content) : checkPackContent(content);
}

/** Ligne → création. `full` : contenu complet (auteur, relecteur) ; sinon les réponses d'un pack sont retirées. */
export function toCreation(r: Row, full: boolean): Creation & { problems: string[] } {
  const kind = r['cre_kind'] as CreationKind;
  const content = r['cre_content'] as SkinContent | PackContent;
  const puzzles = kind === 'pack' ? (content as PackContent).puzzles : [];
  return {
    id: r['cre_id'],
    kind,
    authorId: r['cre_author_htr'],
    authorNickname: r['htr_nickname'],
    name: r['cre_name'],
    description: r['cre_description'],
    price: r['cre_price'],
    status: r['cre_status'],
    note: r['cre_note'],
    content: full || kind === 'skin' ? content : { puzzles: [] },
    cover: kind === 'skin' ? (content as SkinContent).cover : null,
    puzzleCount: puzzles.length,
    published: r['cre_published'] ? (r['cre_published'] as Date).toISOString() : null,
    lastUpdate: (r['cre_lastupdate'] as Date).toISOString(),
    problems: full ? check(kind, content).problems : [],
  };
}

/** Création publiée désignée par son numéro (« u12 »), ou null. */
export async function publishedCreation(db: Db, id: number): Promise<(Creation & { problems: string[] }) | null> {
  const r = await one(db, `${SELECT} WHERE c.cre_id = $1 AND c.cre_status = 'published'`, [id]);
  return r ? toCreation(r, false) : null;
}

/** Produits de la boutique venus des créateurs (publiés), avec le manifeste des skins. */
export async function creationProducts(db: Db, owned: ReadonlySet<string>, me: Viewer): Promise<StoreItem[]> {
  const list = await rows(db, `${SELECT} WHERE c.cre_status = 'published' ORDER BY c.cre_published DESC`);
  return list.map((r) => {
    const c = toCreation(r, false);
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

export class Creations {
  constructor(private readonly pool: pg.Pool) {}

  private me(viewer: Viewer): number {
    if (viewer === null) throw unauthorized();
    return viewer;
  }

  private async isReviewer(me: number): Promise<boolean> {
    return !!(await one(this.pool, 'SELECT 1 FROM th_hunters WHERE htr_id = $1 AND htr_reviewer', [me]));
  }

  private async own(me: number, id: number): Promise<Row> {
    const r = await one(this.pool, `${SELECT} WHERE c.cre_id = $1`, [id]);
    if (!r || r['cre_author_htr'] !== me) throw notFound('Création introuvable.');
    return r;
  }

  async mine(viewer: Viewer): Promise<Creation[]> {
    const me = this.me(viewer);
    return (await rows(this.pool, `${SELECT} WHERE c.cre_author_htr = $1 ORDER BY c.cre_lastupdate DESC`, [me])).map((r) => toCreation(r, true));
  }

  async create(viewer: Viewer, input: CreationInput): Promise<Creation> {
    const me = this.me(viewer);
    const { content, problems } = check(input.kind, input.content);
    const r = await one(
      this.pool,
      `INSERT INTO th_creations (cre_author_htr, cre_kind, cre_name, cre_description, cre_price, cre_content) VALUES ($1, $2, $3, $4, $5, $6) RETURNING cre_id`,
      [me, input.kind, input.name.trim(), input.description.trim(), input.price, JSON.stringify(content)],
    );
    // Ce qui a été refusé à l'enregistrement (jetons dangereux retirés) est signalé une fois.
    return { ...toCreation((await one(this.pool, `${SELECT} WHERE c.cre_id = $1`, [r!['cre_id']]))!, true), problems };
  }

  /** Modifier un brouillon ou une création refusée (qui redevient brouillon). */
  async update(viewer: Viewer, id: number, input: Partial<Omit<CreationInput, 'kind'>>): Promise<Creation> {
    const me = this.me(viewer);
    const r = await this.own(me, id);
    if (r['cre_status'] === 'review') throw conflict('Cette création est en relecture : retirez-la de la relecture pour la modifier.');
    if (r['cre_status'] === 'published') throw conflict('Une création publiée ne se modifie plus : proposez-en une nouvelle version.');
    const checked = input.content !== undefined ? check(r['cre_kind'], input.content) : null;
    const content = checked ? JSON.stringify(checked.content) : null;
    await this.pool.query(
      `UPDATE th_creations SET cre_name = coalesce($2, cre_name), cre_description = coalesce($3, cre_description), cre_price = coalesce($4, cre_price),
              cre_content = coalesce($5::jsonb, cre_content), cre_status = 'draft', cre_lastupdate = now()
       WHERE cre_id = $1`,
      [id, input.name?.trim() ?? null, input.description?.trim() ?? null, input.price ?? null, content],
    );
    const saved = toCreation((await one(this.pool, `${SELECT} WHERE c.cre_id = $1`, [id]))!, true);
    return checked ? { ...saved, problems: checked.problems } : saved;
  }

  async remove(viewer: Viewer, id: number): Promise<void> {
    const r = await this.own(this.me(viewer), id);
    if (r['cre_status'] === 'published') throw conflict('Une création publiée reste disponible pour ceux qui l’ont obtenue.');
    await this.pool.query('DELETE FROM th_creations WHERE cre_id = $1', [id]);
  }

  /** Proposer à la relecture : le contenu doit passer tous les contrôles. */
  async submit(viewer: Viewer, id: number): Promise<Creation> {
    const r = await this.own(this.me(viewer), id);
    if (!['draft', 'rejected'].includes(r['cre_status'])) throw conflict('Cette création est déjà en relecture ou publiée.');
    const problems = check(r['cre_kind'], r['cre_content']).problems;
    if (!r['cre_name'].trim()) problems.unshift('Donnez un nom à votre création.');
    if (problems.length) throw badRequest(problems.join(' '));
    await this.pool.query(`UPDATE th_creations SET cre_status = 'review', cre_note = NULL, cre_lastupdate = now() WHERE cre_id = $1`, [id]);
    return toCreation((await one(this.pool, `${SELECT} WHERE c.cre_id = $1`, [id]))!, true);
  }

  /** Retirer de la relecture, pour la modifier encore. */
  async withdraw(viewer: Viewer, id: number): Promise<Creation> {
    const r = await this.own(this.me(viewer), id);
    if (r['cre_status'] !== 'review') throw conflict('Cette création n’est pas en relecture.');
    await this.pool.query(`UPDATE th_creations SET cre_status = 'draft', cre_lastupdate = now() WHERE cre_id = $1`, [id]);
    return toCreation((await one(this.pool, `${SELECT} WHERE c.cre_id = $1`, [id]))!, true);
  }

  async reviewQueue(viewer: Viewer): Promise<Creation[]> {
    const me = this.me(viewer);
    if (!(await this.isReviewer(me))) throw forbidden('Réservé aux relecteurs.');
    return (await rows(this.pool, `${SELECT} WHERE c.cre_status = 'review' ORDER BY c.cre_lastupdate`)).map((r) => toCreation(r, true));
  }

  /** Publier, ou refuser avec une note qui dit quoi corriger. */
  async review(viewer: Viewer, id: number, decision: { approve: boolean; note: string | null }): Promise<Creation> {
    const me = this.me(viewer);
    if (!(await this.isReviewer(me))) throw forbidden('Réservé aux relecteurs.');
    const r = await one(this.pool, `${SELECT} WHERE c.cre_id = $1`, [id]);
    if (!r) throw notFound('Création introuvable.');
    if (r['cre_status'] !== 'review') throw conflict('Cette création n’attend pas de relecture.');
    if (r['cre_author_htr'] === me) throw forbidden('On ne relit pas ses propres créations.');
    if (!decision.approve && !decision.note?.trim()) throw badRequest('Dites au créateur ce qu’il doit corriger.');
    if (decision.approve && check(r['cre_kind'], r['cre_content']).problems.length) throw conflict('Le contenu ne passe plus les contrôles.');
    await this.pool.query(
      `UPDATE th_creations SET cre_status = $2, cre_note = $3, cre_reviewer_htr = $4, cre_published = CASE WHEN $5 THEN now() END,
              cre_lastupdate = now() WHERE cre_id = $1`,
      [id, decision.approve ? 'published' : 'rejected', decision.note?.trim() || null, me, decision.approve],
    );
    return toCreation((await one(this.pool, `${SELECT} WHERE c.cre_id = $1`, [id]))!, true);
  }

  /** Page publique d'un créateur : ses créations publiées. */
  async creator(id: number): Promise<CreatorPage> {
    const h = await one(this.pool, 'SELECT htr_id, htr_nickname FROM th_hunters WHERE htr_id = $1', [id]);
    if (!h) throw notFound('Créateur introuvable.');
    const list = await rows(this.pool, `${SELECT} WHERE c.cre_author_htr = $1 AND c.cre_status = 'published' ORDER BY c.cre_published DESC`, [id]);
    return { id, nickname: h['htr_nickname'], creations: list.map((r) => toCreation(r, false)) };
  }

  /** Manifeste d'un skin de créateur publié : public, c'est l'habillage des chasses qui l'utilisent. */
  async skin(id: number): Promise<SkinManifest> {
    const c = await publishedCreation(this.pool, id);
    if (!c || c.kind !== 'skin') throw notFound('Skin introuvable.');
    return creatorSkin(c, c.content as SkinContent);
  }

  /** Énigmes d'un pack de créateur : pour qui l'a obtenu, son auteur et les relecteurs. */
  async packPuzzles(viewer: Viewer, id: number): Promise<Puzzle[]> {
    const me = this.me(viewer);
    const r = await one(this.pool, `${SELECT} WHERE c.cre_id = $1 AND c.cre_kind = 'pack'`, [id]);
    if (!r) throw notFound('Pack introuvable.');
    const allowed =
      r['cre_author_htr'] === me ||
      (r['cre_status'] === 'published' && !!(await one(this.pool, 'SELECT 1 FROM th_purchases WHERE pur_hunter_htr = $1 AND pur_product = $2', [me, creationProductId('pack', id)]))) ||
      (await this.isReviewer(me));
    if (!allowed) throw forbidden('Obtenez d’abord ce pack dans la boutique.');
    return (r['cre_content'] as PackContent).puzzles;
  }
}
