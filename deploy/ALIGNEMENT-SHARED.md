# Alignement sur le modèle `shared` révisé (platform-patterns 1.0.0)

Comparaison de l'installation actuelle de SecretTracks (`deploy/`, chart `app`
0.4.0, socle homelab-platform) avec le modèle `shared` réaligné de
[platform-patterns](https://github.com/hseb72/platform-patterns) :
[ADR 0001](https://github.com/hseb72/platform-patterns/blob/main/docs/adr/0001-shared-model.md),
[docs/patterns/shared.md](https://github.com/hseb72/platform-patterns/blob/main/docs/patterns/shared.md),
charts `app` 1.0.0 et `platform` 1.0.0 (publiés : tags `app-1.0.0`,
`platform-1.0.0`). État comparé : `master` de treasurehunters au 21/10/2026.

## En bref

L'installation suit l'**ancien** modèle `shared` (≤ 0.5.0) : un seul namespace
`treasurehunters`, des étiquettes d'adhésion posées par Argo, un mot de passe
PostgreSQL statique dans un Secret créé à la main, et trois manifestes locaux qui
comblaient les manques du chart 0.4.0.

Le modèle révisé demande :

- **deux namespaces** par application (`ui-treasurehunters`, `api-treasurehunters`), créés et étiquetés par le chart ;
- **le front servi directement** par l'Ingress d'entrée, et **seul `/api` passe par Kong**, sur l'hôte de l'application ;
- **des identifiants PostgreSQL dynamiques** délivrés par Vault (Agent injector), que l'application lit dans un fichier et renouvelle à chaud ;
- un **provisionnement en libre-service** (Jobs PreSync) au lieu d'une déclaration au socle ;
- le profil Pod Security **`restricted`**.

Les trois manifestes locaux sont désormais couverts par le chart 1.0.0.
L'essentiel des écarts se résorbe donc en supprimant du code, pas en en ajoutant.

**Point bloquant.** Le socle actuel (homelab-platform) est lui-même antérieur au
réalignement : pas de Vault, pas de CloudNativePG, des namespaces et des
étiquettes aux anciens noms, le provisionnement centralisé. L'application peut
s'aligner tout de suite sur la **forme** du modèle (étape 1 ci-dessous). Pour le
**fond** (Vault, provisionnement en libre-service, `/api` sur l'hôte du front),
il faut que le socle passe au modèle réaligné.

## Écarts

Gravité : **B** bloquant pour être conforme · **M** majeur · **m** mineur.
Côté : **A** ce dépôt · **S** socle (homelab-platform) · **P** platform-patterns.

### Structure et version

| # | Sujet | Modèle révisé | Aujourd'hui | Grav. | Côté |
|---|---|---|---|---|---|
| E1 | Version du chart | `app` **1.0.0** (épinglée) | `app` **0.4.0** (`argocd/application.yaml`) | B | A |
| E2 | Namespaces de l'application | `ui-<app>` (front) + `api-<app>` (back), **créés par le chart** (`shared.namespaces.create`) | un seul namespace `treasurehunters`, créé par Argo (`CreateNamespace=true`) | B | A |
| E3 | Adhésion aux services mutualisés | `shared.clients` : le chart pose sur `api-<app>` l'étiquette de chaque service (`platform-patterns.io/<svc>-client`). **Pas** de `managedNamespaceMetadata` | `managedNamespaceMetadata` d'Argo : `database-client`, `object-store-client` sur le namespace unique | B | A + S |
| E4 | AppProject | destinations : `ui-<app>` et `api-<app>` | une seule destination `treasurehunters` | M | A |
| E5 | Manifestes locaux (`deploy/manifests/`) | rien hors chart : `shared.kongIngress`, `shared.webIngress`, `shared.networkPolicy` | 3 manifestes et une 3ᵉ source Argo : Ingress kong, Ingress nginx, NetworkPolicy « ingress-nginx → web » | M | A |

### Routage

| # | Sujet | Modèle révisé | Aujourd'hui | Grav. | Côté |
|---|---|---|---|---|---|
| E6 | Chemin de l'API (front SPA) | le **navigateur** appelle `/api` : Ingress d'entrée → Kong → API. **Le pod UI n'appelle jamais l'API** | le nginx du front **relaie `/api` vers Kong** (`docker/nginx.conf.template`, `API_UPSTREAM`, `DNS_RESOLVER`) : le pod UI appelle l'API | B | A + S |
| E7 | Hôte de l'API | `/api` routé par Kong **sur l'hôte de l'application** (`kongIngress.hosts: [treasurehunters.crealcs.com]`, `rules: /api`) | hôte séparé `api.treasurehunters.crealcs.com`, règle `/`. Le webhook Stripe pointe dessus | M | A + S |
| E8 | Taille des requêtes | limite portée par la route `/api` : Kong (plugin `request-size`, à garder minimal) et entrée du socle | 10 Mo posés sur l'Ingress du front **et** sur le relais nginx (photos) | M | A + S |

### Sécurité et secrets

| # | Sujet | Modèle révisé | Aujourd'hui | Grav. | Côté |
|---|---|---|---|---|---|
| E9 | Pod Security | `securityContext` restreint posé par le chart, namespaces en `restricted` | pas de `securityContext`. Namespace en `enforce: baseline`, `warn/audit: restricted` | M | A |
| E10 | Utilisateur de l'image API | utilisateur **numérique** exigé par `runAsNonRoot` | `USER node` (nom, pas numéro) : le pod sera **refusé** avec le chart 1.0.0 (« image has non-numeric user ») | B | A |
| E11 | Identifiants PostgreSQL | **Vault dynamique** : Agent injector, `DATABASE_URL` rendue dans `/vault/secrets/db`, bail court, l'application **se reconnecte à la rotation** | mot de passe **statique** du locataire, recopié dans `DATABASE_URL` (Secret créé par `create-secrets.sh`). L'API ne lit que la variable d'environnement, une fois au démarrage | B | A + S |
| E12 | Migrations avec des rôles éphémères | (non traité par le modèle) | l'API migre au démarrage. Avec les `creationStatements` par défaut du chart, les tables appartiendraient à un rôle Vault éphémère : migrations suivantes en échec, révocation du bail impossible tant que le rôle possède des objets | B | A + P |
| E13 | Autres secrets inter-namespaces (clés MinIO) | dans Vault (statique à rotation planifiée + Reloader) | Secret Kubernetes créé à la main (`create-secrets.sh`), copie scellée hors dépôt | M | A + S |
| E14 | Secrets tiers (Anthropic, Stripe, Safe Browsing) | non imposé (ils ne sont pas inter-namespaces). Vault recommandé par cohérence | Secret Kubernetes créé à la main | m | A |

### Provisionnement et services

| # | Sujet | Modèle révisé | Aujourd'hui | Grav. | Côté |
|---|---|---|---|---|---|
| E15 | Provisionnement | **libre-service** : Jobs PreSync dans le namespace de l'app (base + rôle Vault, seau MinIO), avec des identifiants de gestion délivrés par la plateforme | **centralisé** : locataire déclaré dans `homelab-platform/{database,object-store}/values.yaml`. `shared.provisioning.enabled: false` | M | A + S |
| E16 | Adresses des services | `postgres-rw.postgres.svc`, `minio.minio.svc`, Kong en `kong`, entrée en `front`, Vault en `vault` | `postgres.database.svc`, `minio.object-store.svc`, Kong en `gateway`, entrée en `platform-ingress`, pas de Vault | B | S puis A |

### Observabilité et documentation

| # | Sujet | Modèle révisé | Aujourd'hui | Grav. | Côté |
|---|---|---|---|---|---|
| E17 | Observabilité | `ServiceMonitor` facultatif sur `/api/metrics`, `PrometheusRule` | pas d'endpoint de métriques, rien de rendu | m | A |
| E18 | Documentation de déploiement | — | `deploy/README.md` décrit l'ancien modèle et liste trois « écarts connus » que le chart 1.0.0 a résolus | m | A |

### Déjà conformes

- Chart **OCI épinglé**, mis à jour par choix explicite. Application Argo **multi-source** avec les valeurs dans le dépôt de l'application.
- **GitOps pull** : la CI ne déploie pas, elle promeut le SHA sur `deploy-state`. Rien du cluster dans GitHub.
- Front **SPA** (`front.type: spa` convient). Images non root (uid 1000 pour l'API, 101 pour nginx).
- Pas de Redis utilisé : `clients.redis: false`. Aucune contrainte de préfixe à respecter.
- Sorties réseau (Anthropic, OSM, Wikimedia, Stripe) : le modèle laisse l'egress ouvert, comme aujourd'hui.

## Plan d'action

Quatre étapes, chacune livrable seule. L'étape 1 ne dépend que de ce dépôt. Les
étapes 2 et 3 attendent le socle réaligné. L'hôte du front
`treasurehunters.crealcs.com` **ne change à aucune étape** : il est imprimé dans
les QR codes déjà posés.

### Étape 0 — Préparer le code (ce dépôt, sans effet sur la production)

| Action | Écart | Fait quand |
|---|---|---|
| `docker/api.Dockerfile` : `USER 1000` (au lieu de `node`) | E10 | l'image démarre avec `runAsNonRoot: true` |
| API : lire `DATABASE_URL` depuis un fichier (`DATABASE_URL_FILE`, format `DATABASE_URL=…` rendu par l'Agent), sinon depuis l'environnement | E11 | tests : variable seule, fichier seul, fichier prioritaire |
| API : surveiller le fichier et **recréer le pool** quand il change. En cas d'erreur d'authentification, relire le fichier et réessayer une fois. Fermer l'ancien pool après les requêtes en cours | E11 | test : rotation simulée, aucune requête perdue |
| Migrations : `SET ROLE treasurehunters_owner` avant de migrer (rôle propriétaire `NOLOGIN`). Objets existants réattribués à ce rôle (`REASSIGN OWNED`) | E12 | migrations rejouables sous un rôle éphémère membre du propriétaire |
| (Facultatif) endpoint `/api/metrics` (prom-client) | E17 | `curl /api/metrics` répond |

### Étape 1 — Forme du modèle sur le socle actuel (ce dépôt)

Le chart 1.0.0 se configure pour le socle d'aujourd'hui : on garde les anciens
noms d'étiquettes (`shared.clientLabels`) et de namespaces (`gateway`,
`platform-ingress`). Valeurs proposées en annexe A ; elles passent le schéma du
chart 1.0.0.

| Action | Écarts |
|---|---|
| `argocd/application.yaml` : chart `app` **1.0.0** ; supprimer la 3ᵉ source (`deploy/manifests`), `CreateNamespace` et `managedNamespaceMetadata` ; destination `api-treasurehunters` | E1, E3, E5 |
| `values.yaml` : `shared.namespaces.create`, `shared.clients` + `clientLabels` aux noms du socle, `webIngress`, `kongIngress` (hôte d'API inchangé pour l'instant), `securityContext.pod.runAsUser: 1000` | E2, E3, E5, E9 |
| `argocd/project.yaml` : destinations `ui-treasurehunters` et `api-treasurehunters` | E4 |
| Supprimer `deploy/manifests/` | E5 |
| `create-secrets.sh` : Secret dans `api-treasurehunters` | E2 |
| Pod Security `restricted` sur les deux namespaces (le chart 1.0.0 ne pose pas ces étiquettes : à demander à platform-patterns, cf. R3, ou à poser par le socle) | E9 |
| Bascule « construire puis couper » : déployer à côté (nouveaux namespaces), vérifier `/healthz` et `/api/health` par `--resolve`, basculer l'Ingress, puis supprimer l'ancien namespace `treasurehunters` | — |
| Socle : redéclarer l'hôte d'API côté `gateway` ; vérifier que la base accepte les connexions du namespace `api-treasurehunters` (étiquette `database-client`) | E3 |

**Reste après l'étape 1** : le relais `/api` du nginx (E6) tant que le socle
n'amène pas `/api` de l'hôte du front à Kong, le mot de passe statique (E11) et
le provisionnement centralisé (E15).

### Étape 2 — Socle réaligné (homelab-platform, hors de ce dépôt)

Prérequis des étapes 3 et 4. À piloter dans le dépôt d'exploitation.

- Passer le socle sur `charts/platform` 1.0.0, ou un équivalent qui respecte le contrat :
  - un namespace par service : `front`, `kong`, `vault`, `postgres` (CNPG), `minio`, `redis` ;
  - étiquettes `platform-patterns.io/<svc>-client`.
- **Vault** : amorçage hors bande (init, unseal, auth Kubernetes, moteur `database` relié à PostgreSQL), et injecteur actif.
- **Routage** : l'entrée amène `treasurehunters.crealcs.com/api` à Kong (chemin, plus seulement hôte), avec une limite de 10 Mo (E6, E7, E8).
- **Identifiants de gestion** par application : `treasurehunters-pg-provisioner`, `treasurehunters-vault-provisioner`, `treasurehunters-minio-provisioner`. Ils sont délivrés au namespace `api-treasurehunters`, jamais créés par l'application (E15).
- **Migration des données** : `pg_dump` / `pg_restore` de la base `treasurehunters` vers `postgres-rw.postgres`, `mc mirror` du seau vers `minio.minio`.

### Étape 3 — Fond du modèle (ce dépôt, après l'étape 2)

| Action | Écarts |
|---|---|
| `values.yaml` cible (annexe B) : `clients.vault: true`, `shared.vault.enabled`, `provisioning.enabled` (base + rôle Vault + seau), adresses `postgres-rw.postgres` et `minio.minio`, `gatewayDataplaneNamespace: kong`, `webIngress.controllerNamespace: front`. Retirer `clientLabels` (valeurs par défaut) | E11, E15, E16 |
| `kongIngress` : hôte `treasurehunters.crealcs.com`, règle `/api` ; retirer l'hôte `api.` | E7 |
| `creationStatements` Vault : `… IN ROLE treasurehunters_owner` et `ALTER ROLE "{{name}}" SET role = 'treasurehunters_owner'` | E12 |
| `DATABASE_URL_FILE=/vault/secrets/db`. `DATABASE_URL` disparaît du Secret | E11 |
| Front : supprimer le relais `/api` du nginx (`location /api/`, `API_HOST`, `API_UPSTREAM`, `DNS_RESOLVER`) | E6 |
| Stripe : déplacer l'endpoint de webhook vers `https://treasurehunters.crealcs.com/api/payments/webhook`. Garder l'ancien hôte le temps de la bascule | E7 |
| Clés MinIO : chemin statique Vault + Reloader (ou Secret géré par la plateforme) | E13 |
| `create-secrets.sh` réduit aux secrets tiers (Anthropic, Stripe), ou ceux-ci dans Vault (KV) | E13, E14 |

### Étape 4 — Finitions

- `ServiceMonitor` et `PrometheusRule` (5xx, latence, pool PostgreSQL saturé) si l'endpoint `/api/metrics` existe (E17).
- Vérifier la route de l'API dans le **route report** de la plateforme.
- Réécrire `deploy/README.md` selon le modèle révisé, et supprimer la section « Écarts connus » (E18).
- Supprimer l'hôte `api.treasurehunters.crealcs.com` (DNS, entrée du socle) une fois Stripe basculé.

## À remonter à platform-patterns

- **R1 — Migrations sous identifiants dynamiques.** Les `creationStatements` par défaut créent des rôles éphémères qui posséderont les tables créées par l'application. Prévoir un rôle propriétaire par application et un modèle `IN ROLE` / `SET role`. Documenter le cas « l'application migre elle-même au démarrage ».
- **R2 — Format du fichier rendu.** Le gabarit rend `DATABASE_URL=…` (ligne `clé=valeur`) et non l'URL seule. Le préciser dans `shared.md`, ou proposer un gabarit URL seule.
- **R3 — Pod Security.** Le chart crée les namespaces sans étiquette `pod-security.kubernetes.io/enforce`. Proposer `shared.namespaces.podSecurity: restricted`.
- **R4 — Sidecar Vault et `restricted`.** Vérifier que l'Agent injecté respecte le profil `restricted` (`securityContext` de l'injecteur dans `charts/platform`).
- **R5 — Transition des étiquettes.** `shared.clientLabels` permet déjà de viser un socle aux anciens noms : à documenter comme chemin de migration.

## Questions ouvertes

1. Calendrier du réalignement de homelab-platform (étape 2) : c'est lui qui fixe celui des étapes 3 et 4.
2. Faut-il garder l'hôte `api.treasurehunters.crealcs.com` pour des clients externes (en plus de Stripe) ? Si oui, `kongIngress.hosts` peut porter les deux hôtes.
3. Secrets tiers (Anthropic, Stripe) dans Vault, ou en Secret Kubernetes comme aujourd'hui ?

## Annexe A — `values.yaml`, étape 1 (socle actuel)

```yaml
mode: shared
web:
  enabled: true
  image: { repository: ghcr.io/hseb72/treasurehunters/web }
  replicas: 2
  port: 8080
  healthPath: /healthz
api:
  enabled: true
  image: { repository: ghcr.io/hseb72/treasurehunters/api }
  replicas: 2
  port: 5080
  healthPath: /api/health
  env: { … inchangé … }
  envFrom: [treasurehunters-api-secrets]
  pdb: { enabled: true, minAvailable: 1 }
securityContext:
  pod:
    runAsUser: 1000          # en plus des valeurs restreintes par défaut du chart
shared:
  namespaces: { create: true }          # ui-treasurehunters, api-treasurehunters
  front: { type: spa }
  clients: { postgres: true, minio: true, redis: false, vault: false }
  clientLabels:                         # noms du socle actuel
    postgres: database-client
    minio: object-store-client
    redis: cache-client
    vault: platform-patterns.io/vault-client
    kong: platform-patterns.io/kong-client
  gatewayDataplaneNamespace: gateway
  webIngress:
    enabled: true
    className: nginx
    controllerNamespace: platform-ingress
    hosts: [treasurehunters.crealcs.com]
    annotations:
      nginx.ingress.kubernetes.io/proxy-body-size: 10m
    tls: { enabled: true, clusterIssuer: letsencrypt-http01, secretName: treasurehunters-tls }
  kongIngress:
    enabled: true
    className: kong
    hosts: [api.treasurehunters.crealcs.com]
    rules:
      - { path: /, service: api }
  networkPolicy: { enabled: true }
  provisioning: { enabled: false }      # le socle provisionne encore
```

## Annexe B — `values.yaml` cible (socle réaligné)

```yaml
mode: shared
web:
  enabled: true
  image: { repository: ghcr.io/hseb72/treasurehunters/web }
api:
  enabled: true
  image: { repository: ghcr.io/hseb72/treasurehunters/api }
  env:
    # … inchangé, sauf :
    DATABASE_URL_FILE: /vault/secrets/db
    PHOTO_S3_ENDPOINT: http://minio.minio.svc.cluster.local:9000
    PHOTO_S3_BUCKET: treasurehunters
  envFrom: [treasurehunters-api-secrets]   # secrets tiers seulement
  pdb: { enabled: true, minAvailable: 1 }
securityContext:
  pod:
    runAsUser: 1000
shared:
  namespaces: { create: true }
  front: { type: spa }
  clients: { postgres: true, minio: true, redis: false, vault: true }
  gatewayDataplaneNamespace: kong
  vault:
    enabled: true
    pgHost: postgres-rw.postgres.svc.cluster.local
  webIngress:
    enabled: true
    className: nginx
    controllerNamespace: front
    hosts: [treasurehunters.crealcs.com]
    annotations:
      nginx.ingress.kubernetes.io/proxy-body-size: 10m
    tls: { enabled: true, clusterIssuer: letsencrypt-http01, secretName: treasurehunters-tls }
  kongIngress:
    enabled: true
    className: kong
    hosts: [treasurehunters.crealcs.com]
    rules:
      - { path: /api, service: api }
  networkPolicy: { enabled: true }
  provisioning:
    enabled: true
    postgres:
      enabled: true
      host: postgres-rw.postgres.svc.cluster.local
      adminSecret: treasurehunters-pg-provisioner
      vault:
        enabled: true
        tokenSecret: treasurehunters-vault-provisioner
        # creationStatements : cf. étape 3 (rôle propriétaire, R1)
    minio:
      enabled: true
      endpoint: http://minio.minio.svc.cluster.local:9000
      bucket: treasurehunters
      adminSecret: treasurehunters-minio-provisioner
```

Les deux jeux de valeurs (sans les `env` détaillés) ont été validés contre
`charts/app/values.schema.json` du chart 1.0.0. Ils n'ont pas été rendus par
`helm template`, faute de `helm` dans l'environnement de rédaction : à faire en
CI avant l'étape 1.
