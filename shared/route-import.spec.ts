import { IMPORT_MAX, parseGpx, parsePlaceList } from './route-import.js';

describe('parsePlaceList', () => {
  it('lit noms et coordonnées sous plusieurs formes', () => {
    const r = parsePlaceList(`
      1. Place de la Comédie ; 43.6085, 3.8797
      43.6115,3.8704 Promenade du Peyrou
      Jardin des plantes - https://www.google.com/maps/@43.6147,3.8723,17z
      La cathédrale Saint-Pierre
    `);
    expect(r.problems).toEqual([]);
    expect(r.places).toEqual([
      { title: 'Place de la Comédie', lat: 43.6085, lng: 3.8797 },
      { title: 'Promenade du Peyrou', lat: 43.6115, lng: 3.8704 },
      { title: 'Jardin des plantes', lat: 43.6147, lng: 3.8723 },
      { title: 'La cathédrale Saint-Pierre', lat: null, lng: null },
    ]);
  });

  it('signale des coordonnées impossibles et limite le nombre de lieux', () => {
    expect(parsePlaceList('Nulle part 95.1234, 3.1234').problems[0]).toContain('impossibles');
    const many = Array.from({ length: IMPORT_MAX + 5 }, (_, i) => `Lieu ${i}`).join('\n');
    const r = parsePlaceList(many);
    expect(r.places).toHaveLength(IMPORT_MAX);
    expect(r.problems[0]).toContain(`${IMPORT_MAX} premiers`);
  });
});

describe('parseGpx', () => {
  it('prend les points de passage, sinon l’itinéraire', () => {
    const wpt = parseGpx(`<?xml version="1.0"?><gpx><wpt lat="43.6085" lon="3.8797"><name>Comédie &amp; Opéra</name></wpt><wpt lat='43.61' lon='3.87'/></gpx>`);
    expect(wpt.places).toEqual([
      { title: 'Comédie & Opéra', lat: 43.6085, lng: 3.8797 },
      { title: 'Lieu 2', lat: 43.61, lng: 3.87 },
    ]);
    const rte = parseGpx(`<gpx><rte><rtept lat="1.5" lon="2.5"><name><![CDATA[Départ]]></name></rtept></rte></gpx>`);
    expect(rte.places).toEqual([{ title: 'Départ', lat: 1.5, lng: 2.5 }]);
  });

  it('explique qu’une trace seule ne suffit pas', () => {
    const r = parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>');
    expect(r.places).toEqual([]);
    expect(r.problems[0]).toContain('points de passage');
  });
});
