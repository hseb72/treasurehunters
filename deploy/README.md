# Déploiement — SecretTracks sur la plateforme mutualisée

SecretTracks suit le **pattern `shared`** de
[platform-patterns](https://github.com/hseb72/platform-patterns) (chart `app`
**1.0.0**). Il se pose sur le socle décrit dans
[homelab-platform](https://github.com/hseb72/homelab-platform) : ingress-nginx,
Kong, cert-manager, PostgreSQL mutualisé **CloudNativePG**, MinIO mutualisé et
SealedSecrets.

Modèle réaligné (1.0.0) : le chart POSSÈDE **deux namespaces** et y rend tout —
`ui-treasurehunters` (front) et `api-treasurehunters` (API). Plus de
`deploy/manifests/` : le chart rend les deux Ingress et les NetworkPolicies.

## Le chemin d'une requête

```
Internet
   │
   ▼
ingress-nginx (ns ingress) ── TLS cert-manager + WAF
   │
   ├──▶ treasurehunters.crealcs.com ─────▶ web (nginx, ns ui-treasurehunters)
   │        pages, QR codes /q/<jeton>          │
   │                                            └── relaie /api ──┐
   │                                                              ▼
   └──▶ api.treasurehunters.crealcs.com ──▶ kong-proxy (ns kong)
                                                  │  Ingress classe kong
                                                  ▼
                                          api (Node.js, ns api-treasurehunters)
                                                  │
                             ┌────────────────────┼─────────────────────┐
                             ▼                                           ▼
            PostgreSQL mutualisé CNPG (ns postgres)       MinIO mutualisé (ns minio)
            service postgres-rw · base/rôle                seau `treasurehunters`
            `treasurehunters`                              (preuve par photo, §12)
```

Le front appelle l'API en chemin relatif (`/api`), sous la même origine. Les QR
codes n'ont qu'un seul hôte à connaître. Le relais passe par Kong, jamais
directement par l'API.

## Ce qui vient d'où

| Élément | Source |
|---|---|
| Deployments / Services `web` et `api`, ConfigMap `api-config`, PDB, les **deux Ingress** (nginx du front, kong de l'API) et les **NetworkPolicies** | chart `app` 1.0.0 de platform-patterns (OCI, **épinglé**), valeurs [`values.yaml`](values.yaml) |
| Tag des images | `deploy/values-image.yaml` sur la branche **`deploy-state`**, écrit par la CI |
| Ce qu'Argo CD lit | la branche d'environnement **`deploy-state`** : copie de `deploy/` depuis `master`, plus le tag d'image. master est protégée, Argo exige une seule révision par dépôt |
| Secret `treasurehunters-api-secrets` (`DB_PASSWORD`, `DATABASE_URL`, `PHOTO_S3_*`, `ANTHROPIC_*`, `STRIPE_*`) | créé **dans le cluster** par [`create-secrets.sh`](create-secrets.sh), jamais versionné |
| Base/rôle `treasurehunters` (CNPG) + seau/utilisateur MinIO | provisionnés **hors-bande** (cf. ci-dessous) ; hôte public de l'API amené à kong-proxy par le **socle** (gateway) |

Le chart pose `platform-patterns.io/postgres-client` et `…/minio-client` sur
`api-treasurehunters`. Les images tournent en non-root numérique (uid 1000 API,
101 nginx) : le `securityContext` `restricted` du chart passe sans réglage.

L'API applique elle-même les migrations SQL au démarrage, sous verrou PostgreSQL.

> **Provisionnement hors-bande (ce cluster).** Sur k3s/kube-router, le Job
> PreSync de provisionnement du chart échoue (latence d'indexation des
> NetworkPolicy), donc `shared.provisioning.enabled: false`. Le slice est créé
> une fois à la main : rôle + base `treasurehunters` dans CNPG, et seau +
> utilisateur `treasurehunters` dans le MinIO mutualisé (runbook de bascule).

## Première installation

**0. Chart publié.** L'Application référence `oci://ghcr.io/hseb72/platform-patterns/app:1.0.0`.
Si le paquet est privé :

```bash
argocd repo add ghcr.io/hseb72/platform-patterns --type helm --enable-oci \
  --username <compte> --password <jeton read:packages>
```

**1. Côté socle (homelab-platform) — provisionnement hors-bande.**
- PostgreSQL CNPG : créer le rôle `treasurehunters` (mot de passe = `DB_PASSWORD`
  du Secret de l'étape 4) et la base `treasurehunters OWNER treasurehunters`
  (via le rôle `provisioner`, cf. runbook).
- MinIO mutualisé : créer le seau `treasurehunters`, un utilisateur
  `treasurehunters` avec une politique d'accès à ce seau, et noter sa clé
  (`PHOTO_S3_SECRET_KEY`).
- L'hôte `api.treasurehunters.crealcs.com` est déjà amené jusqu'à kong-proxy par
  le socle (`gateway/10-ingress-api-hosts.yaml`).

**2. DNS.** Deux enregistrements vers l'IP publique de l'ingress, **avant** la
demande de certificat (HTTP-01) :

```
treasurehunters.crealcs.com.       A   <IP>
api.treasurehunters.crealcs.com.   A   <IP>
```

**3. Images.** Le passage de la CI sur `master` publie
`ghcr.io/hseb72/treasurehunters/{web,api}:<sha>` et écrit ce SHA dans
`deploy/values-image.yaml` (branche `deploy-state`).

**4. Secret de l'API**, créé directement dans le cluster (ns `api-treasurehunters`) :

```bash
PHOTO_S3_SECRET_KEY='<clé MinIO>' ANTHROPIC_API_KEY='sk-ant-…' ./deploy/create-secrets.sh
kubectl -n api-treasurehunters rollout restart deploy/api
```

`DB_PASSWORD` est tiré au hasard la première fois puis conservé (ou passé en
ligne de commande pour reprendre une valeur existante). Relancé sans une valeur,
le script conserve celle déjà en place.

`ANTHROPIC_API_KEY` active la **génération de chasses** (docs/conception.md § 11).
Sans elle, tout le reste fonctionne et `POST /api/hunts/generate` répond 503.
Si l'API répond « This API key is not scoped to a workspace », ajouter
`ANTHROPIC_WORKSPACE_ID='wrkspc_…'`. Réglages facultatifs, dans `api.env` de
`values.yaml` : `GENERATOR_MODEL` (`claude-opus-5`), `GENERATOR_EFFORT` (`medium`),
`GENERATION_DAILY_QUOTA` (`5`), `GUIDE_MODEL` (`claude-sonnet-5`),
`SAFE_BROWSING_API_KEY`.

Les photos libres viennent de `commons.wikimedia.org`, `www.wikidata.org` et
`upload.wikimedia.org` ; le générateur sort vers `api.anthropic.com`,
`nominatim.openstreetmap.org` et `overpass-api.de` (HTTPS). Les NetworkPolicies
du chart laissent la sortie ouverte.

**Preuve par photo** (docs/conception.md § 12) : les photos vont dans le seau
`treasurehunters` du MinIO mutualisé (ns `minio`). Trois conditions :

1. le seau `treasurehunters` et un utilisateur MinIO `treasurehunters` (avec sa
   politique d'accès) existent — créés hors-bande à l'étape 1 ;
2. le namespace `api-treasurehunters` porte `platform-patterns.io/minio-client:
   "true"` — **posée par le chart** (`shared.clients.minio: true`) ;
3. le Secret de l'API porte `PHOTO_S3_ACCESS_KEY` (= `treasurehunters`) /
   `PHOTO_S3_SECRET_KEY` : `create-secrets.sh` les pose quand `PHOTO_S3_SECRET_KEY`
   est fournie. L'adresse (`minio.minio.svc`) et le seau sont dans `api.env`.

Sans clé, le bouton photo n'apparaît pas. L'avis de l'IA sur les photos utilise
la même clé Anthropic que le générateur.

**Paiement** (docs/conception.md § 20) : Stripe Checkout + Connect. Désactivé tant
que les deux valeurs ne sont pas dans le Secret.

1. dans Stripe : activer Connect, déclarer l'endpoint de webhook
   `https://api.treasurehunters.crealcs.com/api/payments/webhook` avec les événements
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.expired` et `account.updated` ;
2. `STRIPE_SECRET_KEY='sk_live_…' STRIPE_WEBHOOK_SECRET='whsec_…' ./deploy/create-secrets.sh`
   puis redémarrer l'API ;
3. commission et adresse de retour : `STRIPE_COMMISSION_PERCENT` et `APP_URL` dans
   `api.env` de `values.yaml`.

Essayez d'abord avec les clés de test (`sk_test_…`) et la carte 4242 4242 4242 4242.

Paiement activé, la **chasse sur mesure** devient payante (conception § 21). Les
membres fondateurs en sont dispensés ; on les désigne en base (via un pod CNPG) :

```bash
kubectl -n postgres exec -it postgres-1 -- psql -U postgres treasurehunters \
  -c "UPDATE th_hunters SET htr_founder = true WHERE htr_email = 'vous@example.com';"
```

Rien n'est committé. Si `kubeseal` est installé, le script produit aussi une copie
scellée **hors du dépôt** (`~/sealed-secrets/`).

**5. Argo CD :**

```bash
kubectl apply -f deploy/argocd/project.yaml
kubectl apply -f deploy/argocd/application.yaml
kubectl -n argocd get application treasurehunters -w
```

## Vérifier

```bash
curl -fsS https://treasurehunters.crealcs.com/healthz          # front
curl -fsS https://treasurehunters.crealcs.com/api/health       # front → Kong → API → base
curl -fsS https://api.treasurehunters.crealcs.com/api/health   # nginx → Kong → API
kubectl -n api-treasurehunters logs deploy/api | grep -i migration
```

Depuis la VM, ajouter `--resolve <hôte>:443:<IP interne>` (hairpin, cf.
homelab-platform/gateway/README.md).

Jeu de démonstration (facultatif, **pas en production**) :

```bash
kubectl -n api-treasurehunters exec deploy/api -- node dist/server/src/seed-demo.js
```

## Retour arrière

```bash
git switch deploy-state
git revert <commit de promotion>   # Argo redéploie le SHA précédent
git push origin deploy-state
```
