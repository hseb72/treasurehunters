#!/usr/bin/env bash
# Crée le Secret de l'API directement dans le cluster, comme findout (cf. son
# docs/deployment/INSTALL-K3S.md §5b). Aucun secret n'est versionné dans ce dépôt.
#
#   [DB_PASSWORD=<mot de passe>] [ANTHROPIC_API_KEY=<clé>] [ANTHROPIC_WORKSPACE_ID=<wrkspc_…>] ./deploy/create-secrets.sh
#
# DB_PASSWORD, si absent, est lu dans le cluster (Secret database/database-tenant-keys,
# clé `treasurehunters`) : c'est la valeur que le socle donne au rôle PostgreSQL,
# on ne peut donc pas se tromper. Il est encodé pour l'URL (caractères spéciaux admis).
#
# ANTHROPIC_API_KEY (facultative) active la génération de chasses (conception § 11).
# Absente, la clé déjà présente dans le Secret est conservée.
# ANTHROPIC_WORKSPACE_ID (facultatif) : exigé par l'API quand la clé n'est rattachée
# à aucun workspace (« This API key is not scoped to a workspace »). Même règle de
# conservation que la clé.
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

NS=treasurehunters
NAME=treasurehunters-api-secrets

# Valeur d'un Secret existant (vide s'il n'existe pas). Comme le socle
# (`cle="$(cat …)"`), les sauts de ligne finaux sont retirés.
secret_value() {
  kubectl -n "$1" get secret "$2" -o "jsonpath={.data.$3}" 2>/dev/null | base64 -d 2>/dev/null || true
}

if [[ -z "${DB_PASSWORD:-}" ]]; then
  DB_PASSWORD="$(secret_value database database-tenant-keys treasurehunters)"
  [[ -n "$DB_PASSWORD" ]] || { echo "✗ Clé « treasurehunters » absente de database/database-tenant-keys : renseigner DB_PASSWORD." >&2; exit 1; }
  echo "ℹ Mot de passe lu dans database/database-tenant-keys."
fi

# Encodage « pourcent » : un @, :, /, # ou % dans le mot de passe casserait l'URL.
urlencode() {
  local LC_ALL=C s="$1" out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9._~-]) out+="$c" ;;
      *) printf -v c '%%%02X' "'$c"; out+="$c" ;;
    esac
  done
  printf '%s' "$out"
}

# `sslmode=disable` et surtout pas `prefer` : les versions récentes du pilote
# traitent `prefer` comme `verify-full` et exigent TLS, que le PostgreSQL du
# socle n'offre pas (le cloisonnement y est assuré par les NetworkPolicies).
DATABASE_URL="postgresql://treasurehunters:$(urlencode "$DB_PASSWORD")@postgres.database.svc.cluster.local:5432/treasurehunters?sslmode=disable"

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

args=(--from-literal=DATABASE_URL="$DATABASE_URL")
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(secret_value "$NS" "$NAME" ANTHROPIC_API_KEY)}"
if [[ -n "$ANTHROPIC_API_KEY" ]] && ! LC_ALL=C grep -qE '^sk-ant-[A-Za-z0-9_-]{20,}$' <<<"$ANTHROPIC_API_KEY"; then
  echo "✗ ANTHROPIC_API_KEY ne ressemble pas à une clé Anthropic (sk-ant-… suivi de la clé réelle)." >&2
  exit 1
fi
if [[ -n "$ANTHROPIC_API_KEY" ]]; then
  args+=(--from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY")
else
  echo "ℹ ANTHROPIC_API_KEY absente : la génération de chasses restera désactivée."
fi

ANTHROPIC_WORKSPACE_ID="${ANTHROPIC_WORKSPACE_ID:-$(secret_value "$NS" "$NAME" ANTHROPIC_WORKSPACE_ID)}"
if [[ -n "$ANTHROPIC_WORKSPACE_ID" ]] && ! LC_ALL=C grep -qE '^wrkspc_[A-Za-z0-9_-]+$' <<<"$ANTHROPIC_WORKSPACE_ID"; then
  echo "✗ ANTHROPIC_WORKSPACE_ID ne ressemble pas à un identifiant de workspace (wrkspc_…)." >&2
  exit 1
fi
[[ -z "$ANTHROPIC_WORKSPACE_ID" ]] || args+=(--from-literal=ANTHROPIC_WORKSPACE_ID="$ANTHROPIC_WORKSPACE_ID")

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
