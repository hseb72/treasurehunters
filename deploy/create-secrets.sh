#!/usr/bin/env bash
# Crée le Secret de l'API directement dans le cluster, comme findout (cf. son
# docs/deployment/INSTALL-K3S.md §5b). Aucun secret n'est versionné dans ce dépôt.
#
#   DB_PASSWORD=<mot de passe du locataire> [ANTHROPIC_API_KEY=<clé>] ./deploy/create-secrets.sh
#
# ANTHROPIC_API_KEY (facultative) active la génération de chasses (conception § 11).
#
# Le mot de passe est celui du locataire `treasurehunters`, déclaré côté socle
# dans le Secret `database-tenant-keys` du namespace `database` (clé
# `treasurehunters`). Relancer le script met le Secret à jour (rotation) ; les
# pods de l'API le relisent au redémarrage :
#   kubectl -n treasurehunters rollout restart deploy/api
#
# Si `kubeseal` est installé, une copie SCELLÉE est aussi produite, HORS du
# dépôt (SEALED_DIR, par défaut ~/sealed-secrets), à conserver avec celles des
# autres applications du cluster.
set -euo pipefail

: "${DB_PASSWORD:?Renseigner DB_PASSWORD (mot de passe du locataire treasurehunters)}"
NS=treasurehunters
NAME=treasurehunters-api-secrets

# `sslmode=disable` et surtout pas `prefer` : les versions récentes du pilote
# traitent `prefer` comme `verify-full` et exigent TLS, que le PostgreSQL du
# socle n'offre pas (le cloisonnement y est assuré par les NetworkPolicies).
DATABASE_URL="postgresql://treasurehunters:${DB_PASSWORD}@postgres.database.svc.cluster.local:5432/treasurehunters?sslmode=disable"

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

args=(--from-literal=DATABASE_URL="$DATABASE_URL")
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  args+=(--from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY")
else
  echo "ℹ ANTHROPIC_API_KEY absente : la génération de chasses restera désactivée."
fi

manifest="$(kubectl -n "$NS" create secret generic "$NAME" "${args[@]}" --dry-run=client -o yaml)"

# `apply` plutôt que `create` : le script est rejouable.
printf '%s\n' "$manifest" | kubectl apply -f -
echo "✓ Secret $NS/$NAME à jour."

if command -v kubeseal >/dev/null 2>&1; then
  dir="${SEALED_DIR:-$HOME/sealed-secrets}"
  mkdir -p "$dir"
  printf '%s\n' "$manifest" \
    | kubeseal --controller-namespace kube-system --format yaml > "$dir/$NAME.sealed.yaml"
  echo "✓ Copie scellée : $dir/$NAME.sealed.yaml (hors dépôt)."
else
  echo "ℹ kubeseal absent : pas de copie scellée (facultative)."
fi
