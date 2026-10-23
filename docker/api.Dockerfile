# syntax=docker/dockerfile:1
#
# Image de l'API (server/). Elle applique elle-même les migrations au démarrage,
# sous verrou PostgreSQL : plusieurs répliques peuvent démarrer ensemble.
#
#   docker build -f docker/api.Dockerfile -t treasurehunters-api .

ARG BASE_REGISTRY=docker.io
ARG NODE_IMAGE=${BASE_REGISTRY}/library/node:24-alpine

# ── Construction ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app/server
ENV CI=true

COPY server/package.json server/package-lock.json ./
RUN npm ci --ignore-scripts

# Le serveur compile aussi le code partagé (../shared) : même arborescence qu'en dépôt.
COPY shared /app/shared
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# ── Exécution ────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE}
WORKDIR /app/server
ENV NODE_ENV=production \
    PORT=5080 \
    HOST=0.0.0.0

COPY --from=builder --chown=node:node /app/server/package.json ./package.json
COPY --from=builder --chown=node:node /app/server/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/server/dist ./dist
# Les scripts SQL sont cherchés en remontant depuis dist/ : ils doivent être dans /app/db.
COPY --chown=node:node db /app/db

# Compte non privilégié de l'image de base (uid 1000), déclaré en NUMÉRIQUE.
# Le securityContext `restricted` du chart platform-patterns rend `runAsNonRoot:
# true` sans `runAsUser` ; avec un USER par NOM (`node`), kubelet ne peut pas
# vérifier qu'il n'est pas root et refuse le conteneur (« image has non-numeric
# user (node), cannot verify user is non-root »). L'UID numérique lève ce refus.
USER 1000:1000
EXPOSE 5080
CMD ["node", "dist/server/src/main.js"]
