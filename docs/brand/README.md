# Icônes

Sources de l'emblème (rose des vents) :

- `icon.svg` : carré arrondi, pour `public/icons/icon-*.png` (usage « any ») ;
- `maskable.svg` : plein cadre, rose réduite dans la zone sûre, pour `public/icons/maskable-*.png` et `apple-touch-icon.png` ;
- `public/favicon.svg` : rose agrandie pour rester lisible à 16 px ; `public/favicon.ico` en contient les rendus 16, 32 et 48 px.

Les PNG se régénèrent en rendant ces SVG à la taille voulue (par exemple avec Chromium via Playwright).
