# ---------- Стадия 1: зависимости и сборка ----------
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Слой зависимостей кешируется отдельно от исходников.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma.config.ts tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm prisma generate
RUN pnpm exec nest build

# Прод-зависимости отдельным деревом: их и заберёт финальный слой.
RUN pnpm prune --prod

# ---------- Стадия 2: рантайм ----------
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/prisma.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Миграции применяются на старте контейнера, а не на этапе сборки:
# во время build базы данных ещё нет.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/src/main"]
