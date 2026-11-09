# Parcours d'initialisation

Un fichier JSON par Secret Track, au format `SeedHunt` (`shared/seed.ts`), décrit dans
`docs/conception.md` § 51. Contrôle sans rien écrire :

    npm --prefix server run seed:catalog -- --dry-run db/seeds/catalog

Import en production (le dossier est livré dans l'image, sous /app/db) :

    kubectl -n api-treasurehunters exec deploy/api -- node dist/server/src/seed-catalog.js /app/db/seeds/catalog
