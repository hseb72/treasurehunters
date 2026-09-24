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
});
