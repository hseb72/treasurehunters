# Déploiement — Treasure Hunters sur la plateforme mutualisée

Treasure Hunters suit le **pattern `shared`** de
[platform-patterns](https://github.com/hseb72/platform-patterns). Il se pose sur le
socle décrit dans [homelab-platform](https://github.com/hseb72/homelab-platform) :
ingress-nginx, Kong, cert-manager, PostgreSQL mutualisé et SealedSecrets. Ce dépôt
ne déploie **que** l'application, dans un seul namespace : `treasurehunters`.

## Le chemin d'une requête

```
Internet
   │
   ▼
ingress-nginx (ns platform-ingress) ── TLS cert-manager + WAF
   │
   ├──▶ treasurehunters.crealcs.com ─────▶ web (nginx, ns treasurehunters)
   │        pages, QR codes /q/<jeton>          │
   │                                            └── relaie /api ──┐
   │                                                              ▼
   └──▶ api.treasurehunters.crealcs.com ──▶ kong-proxy (ns gateway)
                                                  │  Ingress classe kong
                                                  ▼
                                          api (Node.js, ns treasurehunters)
                                                  │
                                                  ▼
                                   PostgreSQL mutualisé (ns database)
                                   base `treasurehunters`, rôle `treasurehunters`
```

Le front appelle l'API en chemin relatif (`/api`), sous la même origine. Il n'y a
donc pas de CORS à gérer, et les QR codes n'ont qu'un seul hôte à connaître. Le
relais passe par Kong, jamais directement par l'API.

## Ce qui vient d'où

| Élément | Source |
|---|---|
| Deployments / Services `web` et `api`, ConfigMap `api-config`, PDB, NetworkPolicy « Kong seulement » | chart `app` de platform-patterns (OCI, **épinglé**), valeurs [`values.yaml`](values.yaml) |
| Tag des images | `deploy/values-image.yaml` sur la branche **`deploy-state`**, écrit par la CI |
| Ce qu'Argo CD lit | la branche d'environnement **`deploy-state`** : copie de `deploy/` depuis `master`, plus le tag d'image. Tenue à jour par `.github/workflows/deploy.yml` (master est protégée, et Argo exige une seule révision par dépôt) |
| Ingress nginx du front, Ingress kong de l'API, entrée ingress-nginx → web | [`manifests/`](manifests/) |
| Secret `treasurehunters-api-secrets` (`DATABASE_URL`, `ANTHROPIC_API_KEY` facultative) | créé **directement dans le cluster** par [`create-secrets.sh`](create-secrets.sh), jamais versionné (comme findout) |
| Base + rôle `treasurehunters`, hôte public de l'API | **socle** (homelab-platform) |

L'API applique elle-même les migrations SQL au démarrage. Elles sont protégées par
un verrou PostgreSQL : les deux répliques peuvent démarrer ensemble sans risque.

## Première installation

**0. Prérequis côté pattern — chart publié.** L'Application référence
`oci://ghcr.io/hseb72/platform-patterns/app:0.4.0`. Le chart doit donc avoir été
publié (tag `app-0.4.0` dans platform-patterns, cf. `docs/releasing.md`), et Argo CD
doit pouvoir lire le registre :

```bash
argocd repo add ghcr.io/hseb72/platform-patterns --type helm --enable-oci \
  --username <compte> --password <jeton read:packages>   # si le paquet est privé
```

**1. Côté socle (homelab-platform).**
- Déclarer le locataire `treasurehunters` dans `database/values.yaml`.
- Ajouter son mot de passe au Secret `database-tenant-keys`, puis lancer
  `argocd app sync database`.
- Déclarer l'hôte `api.treasurehunters.crealcs.com` dans
  `gateway/10-ingress-api-hosts.yaml`.

**2. DNS.** Deux enregistrements vers l'IP publique de l'ingress, **avant** la
demande de certificat (HTTP-01) :

```
treasurehunters.crealcs.com.       A   <IP>
api.treasurehunters.crealcs.com.   A   <IP>
```

**3. Images.** Le premier passage de la CI sur `master` publie
`ghcr.io/hseb72/treasurehunters/{web,api}:<sha>` et écrit ce SHA dans
`deploy/values-image.yaml`, sur la branche `deploy-state` (créée au premier passage). Si les paquets GHCR sont privés, déclarer un
`imagePullSecret` (`global.imagePullSecrets` dans `values.yaml`) ou rendre les
paquets publics.

**4. Secret de l'API**, créé directement dans le cluster. Le mot de passe est lu
dans la clé `treasurehunters` de `database-tenant-keys` : c'est celle que le socle
donne au rôle PostgreSQL. Il est encodé pour l'URL, donc les caractères spéciaux
sont admis :

```bash
ANTHROPIC_API_KEY='sk-ant-…' ./deploy/create-secrets.sh
kubectl -n treasurehunters rollout restart deploy/api
```

Relancé sans `ANTHROPIC_API_KEY`, le script conserve la clé déjà en place.
`DB_PASSWORD=…` reste possible pour forcer une valeur.

En cas de `password authentication failed for user "treasurehunters"` : relancer
le script tel quel. Si l'erreur persiste, le rôle n'a pas reçu la clé : relancer
le provisionnement (`argocd app sync database`, cf. homelab-platform).

`ANTHROPIC_API_KEY` active la **génération de chasses** (docs/conception.md § 11).
Sans elle, tout le reste fonctionne et `POST /api/hunts/generate` répond 503.
La clé se crée sur console.anthropic.com. Réglages facultatifs, dans `api.env` de
`values.yaml` : `GENERATOR_MODEL` (`claude-opus-5`), `GENERATOR_EFFORT` (`medium`),
`GENERATION_DAILY_QUOTA` (`5`).

Le générateur sort du cluster vers `api.anthropic.com`, `nominatim.openstreetmap.org`
et `overpass-api.de` (HTTPS). Les NetworkPolicies du chart laissent la sortie
ouverte ; rien à faire, sauf si un pare-feu filtre la sortie de la VM.

Rien n'est committé. Si `kubeseal` est installé, le script produit aussi une
copie scellée **hors du dépôt** (`~/sealed-secrets/`), à ranger avec celles des
autres applications. Elle permet de recréer le Secret si le namespace est perdu.

**5. Argo CD :**

```bash
kubectl apply -f deploy/argocd/project.yaml
kubectl apply -f deploy/argocd/application.yaml
kubectl -n argocd get application treasurehunters -w
```

À partir de là, rien ne se fait plus à la main : chaque commit sur `master`
construit les images, la CI promeut leur SHA sur la branche `deploy-state`, et
Argo CD applique.

## Vérifier

```bash
curl -fsS https://treasurehunters.crealcs.com/healthz          # front
curl -fsS https://treasurehunters.crealcs.com/api/health       # front → Kong → API
curl -fsS https://api.treasurehunters.crealcs.com/api/health   # nginx → Kong → API
kubectl -n treasurehunters logs deploy/api | grep -i migration
```

Depuis la VM, ajouter `--resolve <hôte>:443:<IP interne>` (hairpin, cf.
homelab-platform/gateway/README.md).

Jeu de démonstration (facultatif, **pas en production**) :

```bash
kubectl -n treasurehunters exec deploy/api -- node dist/server/src/seed-demo.js
```

## Retour arrière

```bash
git switch deploy-state
git revert <commit de promotion>   # Argo redéploie le SHA précédent
git push origin deploy-state
```

## Écarts connus avec le pattern, à remonter dans platform-patterns

Le chart `app` 0.4.0 en mode `shared` suppose une plateforme Gateway API. Le socle
homelab expose les API par des Ingress de classe `kong` et sert les fronts
directement par ingress-nginx. D'où trois manifestes locaux, qui auraient leur place
dans le chart en option générique :

1. **Ingress kong** pour l'API, en alternative à l'`HTTPRoute`.
2. **Ingress nginx** du front et l'entrée correspondante dans la NetworkPolicy.
3. **`securityContext`** sur les workloads (non-root, `drop: [ALL]`, seccomp).
   Faute de quoi le namespace est en Pod Security `baseline` et non `restricted`.
   Les images, elles, tournent déjà en non-root (uid 1000 pour l'API, 101 pour nginx).
