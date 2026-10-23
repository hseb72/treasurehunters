#!/usr/bin/env bash
# Crée (ou met à jour) le Secret de l'API dans le cluster. Aucun secret n'est
# versionné dans ce dépôt.
#
#   [DB_PASSWORD=<mot de passe>] [ANTHROPIC_API_KEY=<clé>] [ANTHROPIC_WORKSPACE_ID=<wrkspc_…>] \
#   [PHOTO_S3_SECRET_KEY=<clé MinIO>] \
#   [STRIPE_SECRET_KEY=<sk_…>] [STRIPE_WEBHOOK_SECRET=<whsec_…>] ./deploy/create-secrets.sh
#
# ── Modèle réaligné (chart 1.0.0) ────────────────────────────────────────────
# L'API vit dans `api-treasurehunters` et consomme les datastores MUTUALISÉS :
# PostgreSQL CloudNativePG (ns `postgres`, postgres-rw) et MinIO (ns `minio`).
# Le rôle/base et le seau/utilisateur ne sont plus provisionnés par le socle ;
# ils sont posés hors-bande (runbook). Le Job PreSync du chart pose au rôle le
# mot de passe DB_PASSWORD de CE Secret ; l'app s'y connecte via DATABASE_URL,
# dérivée du même DB_PASSWORD — les deux clés vivent donc ici ensemble.
#
# DB_PASSWORD : ligne de commande, sinon valeur du Secret existant, sinon tirée
# au hasard (plus aucune lecture du socle). PHOTO_S3_SECRET_KEY : la clé de
# l'utilisateur MinIO `treasurehunters` (créé hors-bande). ANTHROPIC_API_KEY,
# STRIPE_* : facultatives, conservées si déjà présentes (on relance sans tout
# retaper). Relancer met le Secret à jour ; les pods le relisent au redémarrage :
#   kubectl -n api-treasurehunters rollout restart deploy/api
#
# Si `kubeseal` est installé, une copie SCELLÉE est aussi produite, HORS dépôt.
set -euo pipefail

NS=api-treasurehunters
NAME=treasurehunters-api-secrets
ROLE=treasurehunters
DB=treasurehunters
PGHOST=postgres-rw.postgres.svc.cluster.local

# Valeur d'un Secret existant (vide s'il n'existe pas).
secret_value() {
  kubectl -n "$1" get secret "$2" -o "jsonpath={.data.$3}" 2>/dev/null | base64 -d 2>/dev/null || true
}

# Mot de passe du rôle applicatif : ligne de commande, sinon Secret existant,
# sinon tiré au hasard.
DB_PASSWORD="${DB_PASSWORD:-$(secret_value "$NS" "$NAME" DB_PASSWORD)}"
if [[ -z "$DB_PASSWORD" ]]; then
  DB_PASSWORD="$(openssl rand -base64 36 | tr -d '\n/+=' | cut -c1-32)"
  echo "ℹ DB_PASSWORD tiré au hasard."
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

# `sslmode=disable` : le PostgreSQL mutualisé n'offre pas TLS (cloisonnement par
# NetworkPolicies) ; `prefer` serait traité comme `verify-full` par le pilote.
DATABASE_URL="postgresql://${ROLE}:$(urlencode "$DB_PASSWORD")@${PGHOST}:5432/${DB}?sslmode=disable"

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

# DB_PASSWORD (brut, lu par le Job PreSync) ET DATABASE_URL (lue par l'app).
args=(
  --from-literal=DB_PASSWORD="$DB_PASSWORD"
  --from-literal=DATABASE_URL="$DATABASE_URL"
)

ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(secret_value "$NS" "$NAME" ANTHROPIC_API_KEY)}"
if [[ -n "$ANTHROPIC_API_KEY" ]] && ! LC_ALL=C grep -qE '^sk-ant-[A-Za-z0-9_-]{20,}$' <<<"$ANTHROPIC_API_KEY"; then
  echo "✗ ANTHROPIC_API_KEY ne ressemble pas à une clé Anthropic (sk-ant-…)." >&2; exit 1
fi
if [[ -n "$ANTHROPIC_API_KEY" ]]; then
  args+=(--from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY")
else
  echo "ℹ ANTHROPIC_API_KEY absente : génération de chasses désactivée."
fi

ANTHROPIC_WORKSPACE_ID="${ANTHROPIC_WORKSPACE_ID:-$(secret_value "$NS" "$NAME" ANTHROPIC_WORKSPACE_ID)}"
if [[ -n "$ANTHROPIC_WORKSPACE_ID" ]] && ! LC_ALL=C grep -qE '^wrkspc_[A-Za-z0-9_-]+$' <<<"$ANTHROPIC_WORKSPACE_ID"; then
  echo "✗ ANTHROPIC_WORKSPACE_ID ne ressemble pas à un identifiant (wrkspc_…)." >&2; exit 1
fi
[[ -z "$ANTHROPIC_WORKSPACE_ID" ]] || args+=(--from-literal=ANTHROPIC_WORKSPACE_ID="$ANTHROPIC_WORKSPACE_ID")

# Preuve par photo (§12) : utilisateur MinIO `treasurehunters` du seau mutualisé
# (créé hors-bande). L'access key EST le nom du locataire ; la secret key est
# fournie en ligne de commande ou conservée. Absente : preuve par photo désactivée.
PHOTO_S3_SECRET_KEY="${PHOTO_S3_SECRET_KEY:-$(secret_value "$NS" "$NAME" PHOTO_S3_SECRET_KEY)}"
if [[ -n "$PHOTO_S3_SECRET_KEY" ]]; then
  args+=(--from-literal=PHOTO_S3_ACCESS_KEY=treasurehunters --from-literal=PHOTO_S3_SECRET_KEY="$PHOTO_S3_SECRET_KEY")
  echo "ℹ Clé MinIO présente : preuve par photo activée."
else
  echo "ℹ Pas de PHOTO_S3_SECRET_KEY : preuve par photo désactivée."
fi

# Paiement (§20) : les deux valeurs vont ensemble.
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-$(secret_value "$NS" "$NAME" STRIPE_SECRET_KEY)}"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-$(secret_value "$NS" "$NAME" STRIPE_WEBHOOK_SECRET)}"
if [[ -n "$STRIPE_SECRET_KEY" ]] && ! LC_ALL=C grep -qE '^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$' <<<"$STRIPE_SECRET_KEY"; then
  echo "✗ STRIPE_SECRET_KEY ne ressemble pas à une clé Stripe (sk_live_…/sk_test_…)." >&2; exit 1
fi
if [[ -n "$STRIPE_WEBHOOK_SECRET" ]] && ! LC_ALL=C grep -qE '^whsec_[A-Za-z0-9]{16,}$' <<<"$STRIPE_WEBHOOK_SECRET"; then
  echo "✗ STRIPE_WEBHOOK_SECRET ne ressemble pas à un secret de webhook Stripe (whsec_…)." >&2; exit 1
fi
if [[ -n "$STRIPE_SECRET_KEY" && -n "$STRIPE_WEBHOOK_SECRET" ]]; then
  args+=(--from-literal=STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" --from-literal=STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET")
  echo "ℹ Clés Stripe présentes : paiement activé."
else
  echo "ℹ Clés Stripe absentes ou incomplètes : paiement désactivé (extensions offertes)."
fi

manifest="$(kubectl -n "$NS" create secret generic "$NAME" "${args[@]}" --dry-run=client -o yaml)"
printf '%s\n' "$manifest" | kubectl apply -f -
echo "✓ Secret $NS/$NAME à jour."

if command -v kubeseal >/dev/null 2>&1; then
  dir="${SEALED_DIR:-$HOME/sealed-secrets}"
  mkdir -p "$dir"
  printf '%s\n' "$manifest" | kubeseal --controller-namespace kube-system --format yaml > "$dir/$NAME.sealed.yaml"
  echo "✓ Copie scellée : $dir/$NAME.sealed.yaml (hors dépôt)."
else
  echo "ℹ kubeseal absent : pas de copie scellée (facultative)."
fi
