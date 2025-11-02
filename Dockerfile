FROM node:20-alpine AS base

RUN apk add --no-cache ffmpeg

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

FROM base AS backend-deps

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS web-deps

WORKDIR /app/web

COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS backend-build

WORKDIR /app

COPY --from=backend-deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src
COPY sounds ./sounds

RUN pnpm build

FROM base AS web-build

WORKDIR /app

COPY --from=backend-deps /app/node_modules/zod ./node_modules/zod
COPY --from=web-deps /app/web/node_modules ./web/node_modules
COPY web/package.json web/tsconfig.json web/tsconfig.app.json web/tsconfig.node.json web/vite.config.ts web/tailwind.config.js web/postcss.config.js web/components.json ./web/
COPY web/src ./web/src
COPY web/index.html ./web/
COPY web/public ./web/public
COPY --from=backend-build /app/src ./src

WORKDIR /app/web
RUN pnpm build

FROM base AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/package.json ./package.json
COPY --from=backend-build /app/sounds ./sounds
COPY --from=web-build /app/web/dist ./web/dist

EXPOSE 3000

CMD ["node", "dist/index.js"]

