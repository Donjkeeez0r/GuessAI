# ---------- Стадия 1: сборка Vite ----------
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Пусто по умолчанию: API берётся с origin фронта, nginx проксирует /api и
# /socket.io на бэкенд. Именно поэтому адрес туннеля не вшивается в бандл и
# фронт не нужно пересобирать при его смене. Задавать значение стоит только
# для доступа к бэкенду в обход прокси.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

# Без него LobbyScreen уходит в фолбэк и делает ссылку на origin вместо
# диплинка t.me/<бот>?startapp=<код> — приглашения перестают открываться
# как Mini App.
ARG VITE_BOT_USERNAME=
ENV VITE_BOT_USERNAME=$VITE_BOT_USERNAME

# Звёздочка у лок-файла — чтобы сборка не падала, пока его ещё нет в репозитории.
# pnpm-workspace.yaml тоже нужен на этом шаге: в нём разрешена сборка esbuild
# (allowBuilds), без него pnpm 11 пропускает postinstall и Vite не соберётся.
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install

COPY . .
RUN pnpm run build

# ---------- Стадия 2: раздача статики ----------
FROM nginx:alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
