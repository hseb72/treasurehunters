# Béziers insolite : notes de réécriture

Fichier : `rewrites/beziers-insolite-murs-peints-et-clochers.json`. Le vérificateur (`checkHuntFile`) ne signale aucune erreur et aucun avertissement.

## Méthode

- **Positions** : chaque lieu a été retrouvé dans OpenStreetMap via Nominatim (au plus une requête par seconde, User-Agent `SecretTracks-seed/1.0`). Les coordonnées d'origine étaient toutes celles de nœuds OSM. Les contours des bâtiments (chapelle du Bon-Pasteur, temple, théâtre) viennent de Nominatim `lookup`.
- **Trajets** : Overpass n'était pas joignable depuis l'environnement (connexion coupée par overpass-api.de, miroirs refusés par le proxy). Le réseau de voies a donc été pris dans le thème `transportation/segment` d'**Overture Maps** (version 2026-10-21.0). Ces données reprennent OpenStreetMap (extrait planet du 2026-10-10, sous licence ODbL) : ce sont les mêmes voies et les mêmes noms, avec leurs nœuds de jonction. Le graphe piéton couvre les rues, les voies piétonnes, les escaliers et les chemins de service ; le plus court chemin est calculé avec Dijkstra, entre les points de voie les plus proches de chaque lieu.
- **Pas** : la longueur mesurée, plus les quelques mètres entre la voie et le lieu, divisée par 0,7 m, puis arrondie largement. Les places piétonnes (place du 14-Juillet, place du Général-de-Gaulle) ne sont pas dans le graphe sous forme de surface : les longueurs sont donc approximatives à ± 10 %.

## Trajets retenus

| Trajet | Rues (longueur sur chaque rue) | Mesuré | Annoncé | Ancien texte |
|---|---|---|---|---|
| Départ → Lion | voie de service de la place du 14-Juillet (109 m), rue d'Alsace (45 m), **rue Jules-Ferry** (204 m), bd Frédéric-Mistral (10 m), rue Anatole-France (79 m), place du Général-de-Gaulle (33 m) | 481 m (+ 26 m d'accès) ≈ 725 pas | ~700 pas, 7 à 8 min, sud-ouest | 300 pas |
| Lion → mur peint | place du Général-de-Gaulle (97 m), rue Suchon (30 m), **avenue du 22-Août-1944** (146 m), place de la Victoire (33 m), av. du Maréchal-Foch (25 m) | 330 m (+ 23 m) ≈ 505 pas | ~500 pas, ouest | 200 pas |
| Mur peint → mur du théâtre | **av. du Maréchal-Foch** (25 m), place de la Victoire (49 m) | 74 m (+ 24 m) ≈ 140 pas | ~150 pas, sud | 100 pas |
| Théâtre → fontaine | **place de la Victoire** (42 m) | 42 m (+ 23 m) ≈ 90 pas | moins de 100 pas, nord-ouest | 30 pas |
| Fontaine → fresque Péret | place de la Victoire (9 m), **rue Riccioti** (73 m) | 82 m (+ 14 m) ≈ 140 pas | ~150 pas, nord | 80 pas |
| Fresque Péret → chapelle Saint-Jean-Baptiste | rue Riccioti (50 m), rue Jean-Baptiste-Perdraut (13 m), **rue du Touat** (50 m) | 112 m (+ 11 m) ≈ 175 pas | moins de 200 pas, nord | 100 pas |
| Saint-Jean-Baptiste → Bon-Pasteur | **rue du Touat** (145 m), rue Casimir-Péret (15 m), rue du Bon-Pasteur (14 m) | 173 m (+ 5 m) ≈ 255 pas | ~250 pas, nord | 150 pas |
| Bon-Pasteur → temple | rue du Bon-Pasteur, rue Casimir-Péret, bd d'Angleterre, av. Foch (113 m), **bd de Strasbourg** (218 m), **bd Frédéric-Mistral** (195 m), **rue Jules-Ferry** (204 m), rue d'Alsace (60 m), rue Général-Thomières (50 m) | 839 m ≈ 1 200 pas | ~1 200 pas, une dizaine de min, est | 600 pas |

## Allusions aux noms de rues (faits vérifiés)

- **Rue Jules-Ferry** : « le père de l'école gratuite, laïque et obligatoire ». Ce sont les lois Ferry de 1881-1882.
- **Avenue du 22-Août-1944** : « une libération estivale ». Béziers fut libérée le 22 août 1944 ; la ville commémore sa Libération chaque 22 août.
- **Avenue du Maréchal-Foch** : « le généralissime des Alliés de 1918 ». Foch commandait en chef les armées alliées en 1918.
- **Place de la Victoire** : « le rond-point dont le nom claironne un triomphe ». Selon une source touristique, le nom date de 1924 et rappelle la victoire de 1918 ; par prudence, l'énigme ne donne pas de date. Le mot « victoire » est évité, parce que le titre de l'étape le contient.
- **Rue Riccioti** : je n'ai trouvé aucune source sur l'origine de ce nom. Le prénom de Ricciotti Garibaldi est une piste, mais elle n'est pas vérifiée. L'énigme parle donc seulement d'une « rue au nom italien », sans fait historique.
- **Rue du Touat** : « une oasis du Sahara ». Le Touat est une région d'oasis du Sahara algérien, occupée par la France en 1900.
- **Boulevard de Strasbourg** : « la capitale de l'Alsace ».
- **Boulevard Frédéric-Mistral** : « le poète provençal couronné par le Nobel ». Mistral a reçu le prix Nobel de littérature en 1904.

## Positions corrigées

- **Fontaine de la Victoire** : déplacée de 31 m, depuis le nœud OSM (43.344880, 3.215592) vers le trottoir ouest de la place, près de l'arrêt de bus « Place de la Victoire » (43.344928, 3.215217). D'après OSM, la fontaine est au centre du giratoire, à 12-15 m de la chaussée de tous côtés. L'ancienne énigme (« tenez-vous au bord ») invitait donc à traverser la circulation. De plus, l'ancien point était à 36 m du mur du théâtre et à 39 m du premier mur peint : avec un rayon de 40 m, l'étape se validait dès l'étape précédente. Le nouveau point est à 55 m du théâtre et à 52 m du premier mur.
- **Chapelle du Bon-Pasteur** : l'ancien point était au centre du bâtiment. Il est maintenant rue du Bon-Pasteur, le long du flanc sud (43.347578, 3.215600), à 14 m de l'ancien. La porte n'est pas cartographiée ; tout l'édifice reste dans le rayon de 40 m.
- **Temple** : l'ancien point était à l'intérieur du bâtiment. Il est maintenant rue Général-Thomières, devant le pignon nord-ouest, à l'angle de la rue du Temple (43.346272, 3.222545), à 22 m de l'ancien. La porte n'est pas cartographiée non plus : **à vérifier sur place**.
- Les autres lieux sont à leur nœud OSM, à moins de 15 m d'une voie : Jean Moulin (place piétonne), le Lion, le mur de l'avenue Foch, le mur nord du théâtre, la fresque Péret (6 m de la rue Riccioti) et la chapelle Saint-Jean-Baptiste (5 m de la rue du Touat).

## Corrections de faits

- **Départ** : la fusillade du mur des fusillés date du **7 juin 1944**, pas du 7 août. Le lendemain de l'embuscade du col de Fontjun, 17 ou 18 résistants (le nombre varie selon les sources) furent fusillés sur l'ancien Champ de Mars, aujourd'hui place du 14-Juillet. Le nom de l'objet OSM (`Monument des fusillés du 7 août 1944`) porte cette erreur, qui était passée dans `address` et `startText`. J'ai corrigé les deux textes, pas OSM. J'ai aussi ajouté que Jean Moulin était né à Béziers, ce qui est sûr. La phrase « pierre blonde posée sur sa colline » a été retirée : elle ne correspond pas à ce quartier.
- **Résumé** : le parcours ne passe pas dans le « vieux Béziers », c'est-à-dire autour de la cathédrale, mais dans les faubourgs nord-est. Le résumé et la première énigme sont corrigés.
- **Lion de Magrou** : le nom vient d'OSM. Jean Magrou (1869-1945) est bien un sculpteur né à Béziers, auteur de monuments dans sa ville natale. En revanche, je n'ai trouvé aucune source qui lui attribue ce lion. Le texte dit seulement que le lion porte son nom. J'ai supprimé les phrases sur les lions des blasons et des vieilles fêtes de Béziers, qui ne sont pas vérifiées.
- **Mur du théâtre** : il est peint sur le Théâtre municipal, inscrit aux monuments historiques le 29 octobre 1975 (référence Mérimée PA00103393). Une source parle d'un hommage à la commedia dell'arte, mais elle est seule : je ne l'ai pas reprise. Le joker de l'épreuve affirmait que le mot était écrit sur le mur ; cette affirmation n'est pas vérifiée et a été retirée. Le rébus annonçait « âtre » en trois lettres, alors qu'il en a quatre : c'est corrigé.
- **Fontaine de la Victoire** : je n'ai trouvé aucune source sur l'histoire de la fontaine. Les généralités inventées (abreuvoir, point de ralliement) ont été supprimées.
- **Casimir Péret** : il fut maire de Béziers en 1848, et non en 1851. Il mena le soulèvement biterrois contre le coup d'État de décembre 1851, fut condamné et envoyé au bagne de Cayenne, où il mourut en tentant de s'évader (vers 1855). La consigne du message chiffré parlait d'un « message de résistance », ce qui ne correspondait pas à la réponse « HOMMAGE AU MAIRE » ; elle est réécrite. L'énigme ne dit plus « portrait », parce que le sujet exact de la fresque n'est pas vérifié.
- **Chapelle Saint-Jean-Baptiste** : l'adresse est corrigée (« Chepelle Saint-Jean-Baptise » venait du nom OSM, qui comporte la même faute). La chapelle est de rite orthodoxe (étiquette OSM) et se trouve au 31 bis rue du Touat, d'après un annuaire orthodoxe ancien.
- **Chapelle du Bon-Pasteur** : d'après la fiche du diocèse, sa construction a commencé en 1860, elle a été bénie en 1863, puis désacralisée ; elle appartient aujourd'hui à la ville. J'ai ajouté une photo du domaine public : `File:Eglise Bon Pasteur (Béziers).JPG`, l'image de l'élément Wikidata Q60342073.
- **Temple** : c'est un temple protestant (OSM, Wikidata Q60427413). Le dernier joker maladroit (« quatre syllabes… non, de deux ») est remplacé. Le message final comptait « quatre murs menteurs » alors que le parcours en a trois : c'est corrigé.
- **Vérificateur** : l'ancienne dernière énigme contenait « trésor » et « statues », deux mots du titre de l'arrivée, et l'énigme vers la fresque Péret contenait « peint ». Ce sont des avertissements du contrôle « énigme qui nomme son lieu » ; ils sont tous levés.

## Photos

Je n'ai trouvé sur Commons aucune photo libre géolocalisée du lion, des murs peints, de la fontaine, de la chapelle orthodoxe ou du temple. La photo du théâtre sur Wikidata montre sa façade principale, pas le mur peint : je ne l'ai pas utilisée.
