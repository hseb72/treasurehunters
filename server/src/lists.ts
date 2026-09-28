/**
 * Favoris et listes (§ 38) : la liste « À faire » de chaque joueur, créée d'office, et ses listes
 * à lui. Une liste partagée (code) se remplit à plusieurs : tout membre ajoute et retire des
 * Secret Tracks ; seul son créateur la renomme, la supprime ou en retire des membres.
 */
import pg from 'pg';
import { FAVORITE_NAME, LIST_MAX_ITEMS, LISTS_MAX, TrackList, TrackListDetail } from '../../shared/lists.js';
import { CatalogEntry } from '../../shared/models.js';
import { randomToken } from '../../shared/rules.js';
import { Db, one, Row, rows } from './db.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from './errors.js';

type Viewer = number | null;
type Entries = (db: Db, where: string, params: unknown[]) => Promise<CatalogEntry[]>;

function requireUser(viewer: Viewer): number {
  if (viewer === null) throw unauthorized();
  return viewer;
}

function shareCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomToken(8), (c) => alphabet[c.charCodeAt(0) % alphabet.length]).join('');
}

const SELECT = `SELECT l.*, o.htr_nickname,
                  coalesce((SELECT array_agg(u.htr_nickname ORDER BY m.lme_creation) FROM th_list_members m JOIN th_hunters u ON u.htr_id = m.lme_hunter_htr
                            WHERE m.lme_list_lst = l.lst_id), '{}') AS members,
                  coalesce((SELECT array_agg(i.lit_catalog_cat ORDER BY i.lit_creation DESC) FROM th_list_items i WHERE i.lit_list_lst = l.lst_id), '{}') AS items
                FROM th_lists l JOIN th_hunters o ON o.htr_id = l.lst_owner_htr`;

function toList(r: Row, me: number): TrackList {
  return {
    id: r['lst_id'],
    name: r['lst_name'],
    icon: r['lst_icon'],
    favorite: r['lst_favorite'],
    ownerNickname: r['htr_nickname'],
    mine: r['lst_owner_htr'] === me,
    code: r['lst_code'],
    members: r['members'],
    catalogIds: r['items'],
  };
}

export class Lists {
  constructor(
    private readonly pool: pg.Pool,
    private readonly entries: Entries,
  ) {}

  /** Listes du joueur (la sienne « À faire » d'abord, créée au besoin), puis celles qu'il a rejointes. */
  async mine(viewer: Viewer): Promise<TrackList[]> {
    const me = requireUser(viewer);
    await this.pool.query(
      `INSERT INTO th_lists (lst_owner_htr, lst_name, lst_icon, lst_favorite) VALUES ($1, $2, 'favorite', true)
       ON CONFLICT (lst_owner_htr) WHERE lst_favorite DO NOTHING`,
      [me, FAVORITE_NAME],
    );
    const list = await rows(
      this.pool,
      `${SELECT} WHERE l.lst_owner_htr = $1 OR EXISTS (SELECT 1 FROM th_list_members m WHERE m.lme_list_lst = l.lst_id AND m.lme_hunter_htr = $1)
       ORDER BY (l.lst_owner_htr = $1 AND l.lst_favorite) DESC, l.lst_id`,
      [me],
    );
    return list.map((r) => toList(r, me));
  }

  async get(viewer: Viewer, id: number): Promise<TrackListDetail> {
    const me = requireUser(viewer);
    const list = await this.member(this.pool, me, id);
    // Retirées du catalogue : elles restent dans la liste, mais n'apparaissent plus.
    const entries = list.catalogIds.length ? await this.entries(this.pool, 'c.cat_id = ANY($1) AND c.cat_withdrawn IS NULL', [list.catalogIds]) : [];
    const order = new Map(list.catalogIds.map((c, i) => [c, i]));
    return { ...list, entries: entries.sort((a, b) => order.get(a.id)! - order.get(b.id)!) };
  }

  async create(viewer: Viewer, data: { name: string; icon: string }): Promise<TrackList> {
    const me = requireUser(viewer);
    const count = await one(this.pool, 'SELECT count(*)::int AS n FROM th_lists WHERE lst_owner_htr = $1', [me]);
    if (count!['n'] >= LISTS_MAX) throw conflict(`${LISTS_MAX} listes au plus : supprimez-en une avant d'en créer une autre.`);
    const r = await one(this.pool, 'INSERT INTO th_lists (lst_owner_htr, lst_name, lst_icon) VALUES ($1, $2, $3) RETURNING lst_id', [me, data.name.trim(), data.icon]);
    return this.member(this.pool, me, r!['lst_id']);
  }

  /** Renommer, changer d'icône, partager (code) ou cesser de partager : le créateur seulement. */
  async update(viewer: Viewer, id: number, data: { name?: string; icon?: string; shared?: boolean }): Promise<TrackList> {
    const me = requireUser(viewer);
    const list = await this.owned(me, id);
    if (data.name !== undefined && !list.favorite) await this.pool.query('UPDATE th_lists SET lst_name = $2 WHERE lst_id = $1', [id, data.name.trim()]);
    if (data.icon !== undefined) await this.pool.query('UPDATE th_lists SET lst_icon = $2 WHERE lst_id = $1', [id, data.icon]);
    if (data.shared === true && !list.code) await this.pool.query('UPDATE th_lists SET lst_code = $2 WHERE lst_id = $1', [id, shareCode()]);
    // Ne plus partager : le code ne marche plus et les membres sortent de la liste.
    if (data.shared === false) {
      await this.pool.query('UPDATE th_lists SET lst_code = NULL WHERE lst_id = $1', [id]);
      await this.pool.query('DELETE FROM th_list_members WHERE lme_list_lst = $1', [id]);
    }
    return this.member(this.pool, me, id);
  }

  async remove(viewer: Viewer, id: number): Promise<void> {
    const me = requireUser(viewer);
    const list = await this.owned(me, id);
    if (list.favorite) throw conflict('La liste « À faire » ne se supprime pas ; retirez-en les Secret Tracks.');
    await this.pool.query('DELETE FROM th_lists WHERE lst_id = $1', [id]);
  }

  async add(viewer: Viewer, id: number, catalogId: number): Promise<TrackList> {
    const me = requireUser(viewer);
    const list = await this.member(this.pool, me, id);
    if (list.catalogIds.length >= LIST_MAX_ITEMS) throw conflict(`${LIST_MAX_ITEMS} Secret Tracks au plus par liste.`);
    const cat = await one(this.pool, 'SELECT cat_withdrawn FROM th_catalog WHERE cat_id = $1', [catalogId]);
    if (!cat || cat['cat_withdrawn']) throw notFound('Cette Secret Track n’est pas au catalogue.');
    await this.pool.query('INSERT INTO th_list_items (lit_list_lst, lit_catalog_cat, lit_added_htr) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, catalogId, me]);
    return this.member(this.pool, me, id);
  }

  async drop(viewer: Viewer, id: number, catalogId: number): Promise<TrackList> {
    const me = requireUser(viewer);
    await this.member(this.pool, me, id);
    await this.pool.query('DELETE FROM th_list_items WHERE lit_list_lst = $1 AND lit_catalog_cat = $2', [id, catalogId]);
    return this.member(this.pool, me, id);
  }

  /** Rejoindre une liste partagée par son code. */
  async join(viewer: Viewer, code: string): Promise<TrackList> {
    const me = requireUser(viewer);
    const r = await one(this.pool, 'SELECT lst_id, lst_owner_htr FROM th_lists WHERE lst_code = $1', [code.trim().toUpperCase()]);
    if (!r) throw notFound('Aucune liste partagée avec ce code.');
    if (r['lst_owner_htr'] !== me) {
      const n = await one(this.pool, 'SELECT count(*)::int AS n FROM th_list_members WHERE lme_list_lst = $1', [r['lst_id']]);
      if (n!['n'] >= 50) throw conflict('Cette liste a déjà 50 membres.');
      await this.pool.query('INSERT INTO th_list_members (lme_list_lst, lme_hunter_htr) VALUES ($1, $2) ON CONFLICT DO NOTHING', [r['lst_id'], me]);
    }
    return this.member(this.pool, me, r['lst_id']);
  }

  /** Quitter une liste rejointe. */
  async leave(viewer: Viewer, id: number): Promise<void> {
    const me = requireUser(viewer);
    const list = await this.member(this.pool, me, id);
    if (list.mine) throw badRequest('Vous avez créé cette liste : supprimez-la plutôt.');
    await this.pool.query('DELETE FROM th_list_members WHERE lme_list_lst = $1 AND lme_hunter_htr = $2', [id, me]);
  }

  private async member(db: Db, me: number, id: number): Promise<TrackList> {
    const r = await one(
      db,
      `${SELECT} WHERE l.lst_id = $1 AND (l.lst_owner_htr = $2 OR EXISTS (SELECT 1 FROM th_list_members m WHERE m.lme_list_lst = l.lst_id AND m.lme_hunter_htr = $2))`,
      [id, me],
    );
    if (!r) throw notFound('Liste introuvable.');
    return toList(r, me);
  }

  private async owned(me: number, id: number): Promise<TrackList> {
    const list = await this.member(this.pool, me, id);
    if (!list.mine) throw forbidden('Seul le créateur de la liste peut la modifier.');
    return list;
  }
}
