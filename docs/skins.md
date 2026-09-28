# Créer un skin de chasse

Un skin habille une chasse pour ses joueurs : couleurs, polices, matières, couverture, sons et
animations. Ce guide décrit le format, et comment **proposer un skin ou un pack d'énigmes** depuis
l'atelier créateur (voir « Proposer une création »).

## Principe : un skin est une donnée

Un skin ne contient **ni code ni CSS libre**. C'est un manifeste (`SkinManifest`, dans
`shared/skins.ts`) qui donne des valeurs à une liste fermée de **jetons** de style. L'application
les applique sur les pages de la chasse sous forme de variables CSS `--th-<jeton>` ; tous ses
composants sont écrits avec ces variables. Un skin peut donc changer toute l'apparence d'une chasse
sans pouvoir toucher au reste de l'application.

```ts
{
  id: 'spatial',                 // identifiant stable, en minuscules
  name: 'Mission spatiale',
  description: 'Nuit étoilée, écrans de bord et néons…',
  author: 'SecretTracks',
  price: 0,                      // centimes d'euro ; 0 = offert
  scheme: 'dark',                // 'light' ou 'dark'
  cover: 'data:image/svg+xml,…', // couverture des cartes (16:9 conseillé)
  tokens: { ink: '#e6ecff', 'font-title': "'Orbitron', sans-serif", … },
  fonts: [{ family: 'Orbitron', url: 'https://…/orbitron.woff2', weight: '700' }],
  sounds: { validate: { tones: [[880, 60], [0, 30], [1320, 120]], wave: 'square' } },
  effects: { validate: 'pulse', treasure: 'confetti', confetti: ['#5ee7ff', '#ff7ad9'] },
}
```

## Jetons

Un jeton absent garde la valeur de base de l'application (thème clair et sobre).

| Famille | Jetons |
|---|---|
| Couleurs | `page-bg` (fond de page : couleur, dégradés), `ink`, `ink-soft` (texte posé sur la page), `primary`, `primary-light`, `on-primary`, `secondary` (liens), `accent`, `accent-light`, `success`, `danger`, `neutral`, `border`, `surface`, `surface-raised`, `surface-sunken` |
| Texte des cartes | `surface-ink`, `surface-ink-soft`, `surface-heading` : quand les cartes n'ont pas le même fond que la page (parchemin clair sur fond sombre, comme Médiéval ou Pirates). Par défaut, ceux de la page |
| Bouton principal | `cta`, `on-cta` |
| Polices | `font-body`, `font-title`, `font-display` (grands titres), `font-note` (énigmes, chiffres) |
| Formes et matières | `radius`, `shadow`, `texture` (image posée sur les fonds, ex. grain de papier), `surface-bg`, `surface-border`, `surface-shadow` (cartes), `banner-bg`, `banner-ink`, `banner-title`, `banner-outline` (bandeaux d'en-tête) |
| Titres | `heading-ink`, `title-weight`, `title-case`, `title-spacing`, `display-weight`, `display-spacing`, `display-shadow`, `section-rules` (`block` : filets de part et d'autre des titres de section ; `none`), `section-ink` |
| Énigmes et tampons | `note-size`, `stamp-rotate`, `stamp-border`, `tape` (`block` : ruban adhésif sur la carte de l'énigme) |

La liste fait foi dans `SKIN_TOKENS` ; tout autre jeton est ignoré.

### Valeurs acceptées

Chaque valeur est contrôlée (`safeTokenValue`) avant d'être appliquée ; une valeur refusée est
ignorée, sans erreur :

- pas de `;`, `{`, `}`, `<`, `>`, `\`, ni `@import`, `expression(`, `javascript:` (hors des `url(...)`) :
  une valeur ne peut pas sortir de sa déclaration CSS ;
- des `url(...)` seulement vers `https://…`, ou des `data:` image (png, jpeg, webp, gif, svg),
  police (woff2) ou son (mpeg, ogg, wav, webm) ;
- 4 000 caractères au plus.

## Polices

Les skins intégrés utilisent des polices livrées avec l'application (paquets `@fontsource`). Un
skin tiers déclare les siennes dans `fonts` (woff2 en `https`) : elles sont chargées à la demande
(`FontFace`), quand une page du skin s'affiche. Prévoir une police de repli dans les jetons
(`'Ma Police', system-ui, sans-serif`).

## Sons

Trois moments : `validate` (étape trouvée), `hint` (joker révélé), `treasure` (arrivée). Un son est :

- soit un fichier : `{ url: 'https://…/cloche.mp3' }` ;
- soit une suite de notes synthétisées par le navigateur, sans fichier :
  `{ tones: [[fréquence Hz, durée ms], …], wave: 'sine' | 'square' | 'triangle' | 'sawtooth' }`
  (fréquence 0 = silence ; 12 notes et 800 ms par note au plus).

Les joueurs peuvent couper le son depuis le carnet de route.

## Effets

- `validate` : `'stamp'` (le tampon s'abat), `'pulse'` (une onde) ou `'none'` ;
- `treasure` : `'confetti'` ou `'none'`, avec les couleurs de `confetti`.

Aucune animation si l'appareil demande moins de mouvement.

## Vérifier un skin

- `shared/skins.spec.ts` vérifie que les skins intégrés passent le contrôle ;
- l'aperçu de l'onglet Infos (choix du skin) montre bandeau, énigme, tampons et fait entendre le son ;
- contraste : le texte (`ink`) doit rester lisible sur `surface-raised` et `page-bg`, et
  `banner-title` sur `banner-bg`.

## Proposer une création

L'**atelier créateur** (menu du compte → Atelier créateur, `/creator`) accueille deux sortes de
créations, publiées dans la boutique au nom de leur auteur une fois relues.

### Un skin

1. **Nouveau skin** : partez d'un univers intégré (toutes ses valeurs sont recopiées), puis retouchez
   le schéma clair ou sombre, les couleurs principales, les polices des titres et du texte (parmi
   celles livrées avec l'application), l'animation de validation et les sons (empruntés à un univers).
2. **Couverture** : importez une image (réduite à 640 px, 250 Ko au plus) ou laissez l'atelier la
   dessiner d'après vos couleurs.
3. **Manifeste complet** (avancé) : le JSON du contenu (`scheme`, `tokens`, `fonts`, `cover`,
   `sounds`, `effects`), pour régler n'importe quel jeton de la liste ci-dessus, ajouter une police
   woff2 en https ou un son.
4. L'aperçu joueur se met à jour en direct ; « Essayer » joue le son et l'animation de validation.

Le serveur contrôle le contenu à chaque enregistrement (`checkSkinContent`, `shared/creations.ts`) :

| Élément | Règle |
|---|---|
| Jetons | seulement ceux de la liste ; valeur sans `; { } < > \`, `@import`, `expression(`, `javascript:` ; `url(...)` en https ou `data:` image, police woff2 ou son |
| Polices | 4 au plus ; nom simple (lettres, chiffres, espaces, tirets) ; fichier woff2 en https (ou `data:font/woff2`) |
| Couverture | obligatoire ; https ou `data:image/…` ; 250 Ko au plus |
| Sons | fichier en https ou `data:audio/…`, ou 12 notes au plus (0 à 4 000 Hz, 10 à 1 500 ms) |
| Effets | `validate` : `stamp`, `pulse`, `none` ; `treasure` : `confetti`, `none` ; 8 couleurs hexadécimales au plus |
| Taille | 400 Ko au plus pour tout le contenu |

Ce qui est refusé est **retiré** du brouillon et signalé ; le reste est gardé. Un skin publié
reçoit l'identifiant `u<numéro>` : une chasse le porte comme un univers intégré
(`hun_skin = 'u12'`), et les joueurs le chargent par `GET /api/skins/u12`.

### Un pack d'énigmes

**Nouveau pack d'énigmes** : de 3 à 40 énigmes d'arrivée prêtes à poser (anagramme, message chiffré,
rébus, cadenas, question), chacune contrôlée comme dans l'éditeur d'étapes (`puzzleProblem`).
Préférez des énigmes qui se suffisent à elles-mêmes : elles serviront sur n'importe quel lieu.

Un organisateur qui a obtenu le pack **pioche** ses énigmes dans l'éditeur d'étapes (« Piocher dans
un pack de créateur ») : l'énigme est recopiée dans le formulaire et se pose **sans le pack de son
type** tant que sa consigne, sa réponse et son décalage restent ceux du pack (l'indice peut être
retouché). Les réponses ne sortent jamais de la boutique ni de la page du créateur : seuls les
acheteurs, l'auteur et les relecteurs les lisent.

### Relecture et publication

```
brouillon ──proposer──▶ en relecture ──publier──▶ publiée (boutique, page du créateur)
    ▲                        │
    └──── à corriger ◀───────┘ (note du relecteur)
```

- **Proposer à la relecture** exige un contenu sans problème et un nom. Une création en relecture
  se retire de la relecture pour être modifiée.
- Les **relecteurs** (`th_hunters.htr_reviewer`, posé en base) voient l'onglet « À relire » :
  aperçu du skin ou liste des énigmes avec leurs réponses. Ils vérifient les droits sur les images
  et les polices, la lisibilité (contraste) et le ton ; un refus porte toujours une note.
  On ne relit pas ses propres créations.
- Une création **publiée** ne se modifie plus (on en propose une nouvelle version) et ne se
  supprime pas : ceux qui l'ont obtenue la gardent.
- La **page du créateur** (`/creators/:id`) présente ses créations publiées ; la boutique renvoie
  vers elle (« par … »).

## Et ensuite

- **Paiement** : le prix affiché par le créateur deviendra un prix payé, avec reversement au
  créateur (voir conception § 20).
- **Fichiers** : aujourd'hui les polices et sons externes se donnent par URL https ; un dépôt de
  fichiers dans l'atelier pourra suivre.
