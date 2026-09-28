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
});
