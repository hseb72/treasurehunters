import { EN, translateUi } from './en';

describe('version anglaise (§ 33)', () => {
  it('traduit les textes fixes, et ceux qui portent des nombres ou des noms', () => {
    expect(translateUi('Jouer cette Secret Track')).toBe('Play this Secret Track');
    expect(translateUi('1 étape')).toBe('1 step');
    expect(translateUi('4 étapes')).toBe('4 steps');
    expect(translateUi('Bonjour Zoé 👋')).toBe('Hello Zoé 👋');
    expect(translateUi('Dès 6 ans')).toBe('Ages 6+');
    expect(translateUi('à 1,2 km')).toBe('1,2 km away');
    expect(translateUi(': travaux, lieu transformé')).toBe(': roadworks, place changed');
    expect(translateUi('+2 min pour le joker 1, +5 min pour le 2, +10 min pour le 3')).toBe('+2 min for hint 1, +5 min for hint 2, +10 min for hint 3');
    expect(translateUi(', pénalités comprises (3ᵉ place sur 3). Jouez-la à votre tour, sur place, quand vous voulez.')).toContain('3rd place out of 3');
    expect(translateUi('Sans joker, à obtenir : Finir une Secret Track sans prendre de joker.')).toBe('No hints, to earn: Finish a Secret Track without taking a hint.');
  });

  it('couvre l’inscription et les règles d’une expédition', () => {
    expect(translateUi('Fonder une équipe')).toBe('Start a team');
    expect(translateUi('Rejoindre des équipiers')).toBe('Join teammates');
    expect(translateUi(": tout le monde part ensemble, le premier arrivé l'emporte.")).toBe(': everyone starts together, first to finish wins.');
    expect(translateUi("L'expédition débutera le Thursday 1 October à 14:00.")).toBe('The expedition will start on Thursday 1 October at 14:00.');
    expect(translateUi('Balade : À pied, en toute détente : les lieux sont à quelques rues les uns des autres.')).toBe('Stroll: On foot, at a relaxed pace: places are a few streets apart.');
  });

  it('laisse en français ce qu’il ne connaît pas', () => {
    expect(translateUi('Le Trésor des Nèfles')).toBeNull();
  });

  it('n’a pas de traduction vide', () => {
    expect(Object.entries(EN).filter(([, en]) => !en.trim())).toEqual([]);
  });
});
