#!/usr/bin/env bash
# Dépose le Secret de l'API, SCELLÉ (SealedSecrets), dans deploy/manifests.
# Aucun secret en clair dans Git : seul le fichier scellé est versionné.
#
#   DB_PASSWORD=<mot de passe du locataire> ./deploy/create-secrets.sh
#
# Le mot de passe est celui du locataire `treasurehunters`, déclaré côté socle
# dans le Secret `database-tenant-keys` du namespace `database`.
set -euo pipefail

: "${DB_PASSWORD:?Renseigner DB_PASSWORD (mot de passe du locataire treasurehunters)}"
OUT="$(dirname "$0")/manifests/sealed-api-secrets.yaml"

kubectl -n treasurehunters create secret generic treasurehunters-api-secrets \
  --from-literal=DATABASE_URL="postgresql://treasurehunters:${DB_PASSWORD}@postgres.database.svc.cluster.local:5432/treasurehunters?sslmode=disable" \
  --dry-run=client -o yaml \
  | kubeseal --format yaml > "$OUT"

echo "Secret scellé écrit dans $OUT — à committer."
