# Créer un skin de chasse

Un skin habille une chasse pour ses joueurs : couleurs, polices, matières, couverture, sons et
animations. Ce guide décrit le format ; il servira aussi de base aux créateurs quand la
marketplace s'ouvrira (voir « Et ensuite »).

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
  author: 'Treasure Hunters',
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
| Couleurs | `page-bg` (fond de page : couleur, dégradés), `ink`, `ink-soft`, `primary`, `primary-light`, `on-primary`, `secondary` (liens), `accent`, `accent-light`, `success`, `danger`, `neutral`, `border`, `surface`, `surface-raised`, `surface-sunken` |
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

## Et ensuite

- **Boutique** : les skins, outils de jeu et packs d'énigmes auront une fiche, un prix et un
  propriétaire ; l'acquisition sera d'abord gratuite, le paiement viendra ensuite.
- **Créateurs** : ils pourront soumettre un manifeste (et ses fichiers) depuis l'application. Le
  format déclaratif et le contrôle des valeurs permettent de les accepter sans exécuter leur code ;
  une relecture restera prévue pour le contenu (droits sur les images et les polices, lisibilité).
