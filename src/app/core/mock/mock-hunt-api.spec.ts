import { TestBed } from '@angular/core/testing';
import { DEMO_TOKENS } from '@shared/fixtures';
import { firstValueFrom } from 'rxjs';
import { Session } from '../session';
import { MockHuntApi } from './mock-hunt-api';

describe('MockHuntApi', () => {
  let api: MockHuntApi;
  let session: Session;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [MockHuntApi] });
    api = TestBed.inject(MockHuntApi);
    session = TestBed.inject(Session);
  });

  it('suit le même scénario que le back-end : connexion, scan, carnet de route', async () => {
    session.set(await firstValueFrom(api.login('seb@example.com', 'demo')));
    expect((await firstValueFrom(api.scan(DEMO_TOKENS.nefles[5]))).outcome).toBe('skipped');
    expect((await firstValueFrom(api.scan(DEMO_TOKENS.nefles[3]))).outcome).toBe('validated');
    const play = await firstValueFrom(api.getPlay(1));
    expect(play.validated.length).toBe(3);
    expect(play.position?.total).toBe(6);
  });

  it('montre la photo du lieu aux joueurs seulement si l’organisateur le veut (§ 18)', async () => {
    session.set(await firstValueFrom(api.login('seb@example.com', 'demo')));
    const target = (await firstValueFrom(api.getPlay(1))).clue!.targetOrder;
    session.set(await firstValueFrom(api.login('camille@example.com', 'demo')));
    const step = (await firstValueFrom(api.getSteps(1))).find((s) => s.order === target)!;
    await firstValueFrom(api.setReferencePhoto(step.id, 'data:image/png;base64,iVBORw0KGgo='));
    await firstValueFrom(api.saveStep({ id: step.id, huntId: 1, photoShow: null }));

    session.set(await firstValueFrom(api.login('seb@example.com', 'demo')));
    expect((await firstValueFrom(api.getPlay(1))).clue!.illustration).toBeNull();
    await expect(firstValueFrom(api.illustrationImage(step.id))).rejects.toThrow();

    session.set(await firstValueFrom(api.login('camille@example.com', 'demo')));
    await firstValueFrom(api.saveStep({ id: step.id, huntId: 1, photoShow: 'clue' }));
    session.set(await firstValueFrom(api.login('seb@example.com', 'demo')));
    expect((await firstValueFrom(api.getPlay(1))).clue!.illustration).toBe(step.id);
  });

  it('fait jouer une Secret Track du catalogue en autonomie et classe les joueurs (§ 13.5)', async () => {
    session.set(await firstValueFrom(api.login('zoe@example.com', 'demo')));
    const [entry] = await firstValueFrom(api.listCatalog({ autonomous: true }));
    expect(entry.validation).toBe('geo');
    const hunt = await firstValueFrom(api.playFromCatalog(entry.id));
    expect(hunt).toMatchObject({ surprise: true, status: 'published', catalogId: entry.id });
    expect((await firstValueFrom(api.playFromCatalog(entry.id))).id).toBe(hunt.id);
    expect((await firstValueFrom(api.getCatalogEntry(entry.id))).myPlays).toHaveLength(1);
    const board = await firstValueFrom(api.autonomyLeaderboard(entry.id));
    expect(board.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(board.rows[0].time).toBeLessThan(board.rows[2].time);
  });

  it('fait payer la Secret Track sur mesure, sauf aux fondateurs (§ 21)', async () => {
    const request = { location: { query: 'Nîmes' }, durationMinutes: 45, travel: 'walk', difficulty: 'easy', theme: null, steps: 3, mode: 'play' } as const;
    session.set(await firstValueFrom(api.login('zoe@example.com', 'demo')));
    expect((await firstValueFrom(api.generationAccess())).right).toBeNull();
    await expect(firstValueFrom(api.generateHunt(request))).rejects.toThrow(/payante/);
    await firstValueFrom(api.checkout('gen:single', '/generate'));
    expect((await firstValueFrom(api.generationAccess())).right).toBe('credit');
    await firstValueFrom(api.generateHunt(request));
    expect((await firstValueFrom(api.generationAccess())).credits.available).toBe(0);

    session.set(await firstValueFrom(api.login('seb@example.com', 'demo')));
    expect((await firstValueFrom(api.generationAccess())).right).toBe('founder');
  });

  it('fait remonter les signalements à l’auteur et compte les étapes (§ 22)', async () => {
    session.set(await firstValueFrom(api.login('zoe@example.com', 'demo')));
    const [entry] = await firstValueFrom(api.listCatalog({ autonomous: true }));
    expect((await firstValueFrom(api.getCatalogEntry(entry.id))).openReports).toHaveLength(1);
    session.set(await firstValueFrom(api.login('camille@example.com', 'demo')));
    const [report] = await firstValueFrom(api.catalogReports(entry.id));
    expect(report).toMatchObject({ stepOrder: 2, category: 'works', status: 'open' });
    await firstValueFrom(api.resolveReport(report.id, true));
    expect((await firstValueFrom(api.getCatalogEntry(entry.id))).openReports).toHaveLength(0);
    const stats = await firstValueFrom(api.catalogStats(entry.id));
    expect(stats.finished).toBe(3);
    expect(stats.steps[1].hints).toBe(1);
  });
  it('décompte les suggestions de l’assistant de rédaction, et le souvenir attend l’arrivée (§ 24, § 25)', async () => {
    session.set(await firstValueFrom(api.login('camille@example.com', 'demo')));
    const before = await firstValueFrom(api.assistUsage());
    expect(before).toMatchObject({ plan: 'base', limit: 30, used: 12, remaining: 18 });
    const step = (await firstValueFrom(api.getSteps(2))).find((s) => s.order === 1)!;
    const reply = await firstValueFrom(api.assist(step.id, { action: 'hints', instructions: 'Cherchez la fontaine.', hints: [] }));
    expect(reply.suggestion.hints).toHaveLength(3);
    expect(reply.usage).toMatchObject({ used: 13, remaining: 17, today: 1 });
    await expect(firstValueFrom(api.assist(step.id, { action: 'harder', instructions: '', hints: [] }))).rejects.toThrow(/première version/);

    session.set(await firstValueFrom(api.login('seb@example.com', 'demo')));
    await expect(firstValueFrom(api.getSouvenir(1))).rejects.toThrow(/arrivée/);
  });
});

