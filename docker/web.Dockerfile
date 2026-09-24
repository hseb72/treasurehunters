# syntax=docker/dockerfile:1
#
# Image du front : fichiers statiques Angular servis par nginx non privilégié
# (port 8080, uid 101), avec relais de /api vers la passerelle Kong du socle.
#
#   docker build -f docker/web.Dockerfile -t treasurehunters-web .
#
# L'hôte d'API et l'amont Kong sont des variables d'environnement, substituées
# au démarrage dans la configuration nginx (mécanisme « templates » de l'image) :
# la même image sert en recette et en production.

ARG BASE_REGISTRY=docker.io
ARG NODE_IMAGE=${BASE_REGISTRY}/library/node:24-alpine
ARG NGINX_IMAGE=${BASE_REGISTRY}/nginxinc/nginx-unprivileged:1.27-alpine

# ── Construction ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV CI=true NG_CLI_ANALYTICS=false

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY angular.json tsconfig.json tsconfig.app.json ngsw-config.json ./
COPY public ./public
COPY shared ./shared
COPY src ./src
RUN npx ng build --configuration production

# ── Exécution ────────────────────────────────────────────────────────────────
FROM ${NGINX_IMAGE}

# Valeurs par défaut adaptées à la plateforme mutualisée (k3s) ; surchargeables.
ENV API_HOST=api.treasurehunters.crealcs.com \
    API_UPSTREAM=http://kong-proxy.gateway.svc.cluster.local \
    DNS_RESOLVER=10.43.0.10

COPY --from=builder /app/dist/treasurehunters/browser /usr/share/nginx/html
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080
