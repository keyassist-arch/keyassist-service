# syntax=docker/dockerfile:1
# Railway: set PORT via env (defaults to 3000). Link Postgres + Redis services.
# Playwright base image matches package.json playwright version (browsers + OS libs).

ARG PLAYWRIGHT_VERSION=1.58.2

# --- Build Nest app (TypeScript → dist) ---
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN pnpm run build

# --- Runtime: prebuilt Chromium + deps (aligned with Playwright npm version) ---
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS runner

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000

# Image ships as non-root user `pwuser` (Playwright default)
USER pwuser

CMD ["./docker-entrypoint.sh"]
