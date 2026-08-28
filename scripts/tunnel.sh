#!/usr/bin/env bash
# Поднимает один quick-туннель Cloudflare на фронтенд и печатает адрес,
# который нужно вставить в BotFather.
#
# Туннель нужен ровно один: nginx контейнера фронта проксирует /api и
# /socket.io на бэкенд, поэтому API живёт на том же origin, что и страница,
# и отдельный туннель на порт 3000 не требуется. Адрес API не вшит в бандл —
# пересобирать фронт при смене адреса туннеля не нужно.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${FRONTEND_PORT:-8080}"
CLOUDFLARED="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"

command -v "$CLOUDFLARED" >/dev/null 2>&1 || CLOUDFLARED="$(command -v cloudflared || true)"
if [ -z "$CLOUDFLARED" ] || [ ! -x "$CLOUDFLARED" ]; then
  echo "cloudflared не найден. Установите его или укажите путь: CLOUDFLARED=/путь/к/cloudflared $0" >&2
  exit 1
fi

if ! curl -fsS -o /dev/null "http://localhost:$PORT"; then
  echo "На http://localhost:$PORT никто не отвечает. Сначала: docker compose up -d" >&2
  exit 1
fi

LOG="$(mktemp -t guessai-tunnel-XXXXXX.log)"
echo "Поднимаю туннель на localhost:$PORT ..."

"$CLOUDFLARED" tunnel --url "http://localhost:$PORT" --no-autoupdate >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "cloudflared завершился, лог: $LOG" >&2; exit 1; }
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Адрес туннеля не появился за 60 секунд. Лог: $LOG" >&2
  exit 1
fi

cat <<TXT

  Адрес Mini App: $URL

  Вставьте его в BotFather: Bot Settings -> Configure Mini App -> Enable/Edit.
  Больше ничего делать не нужно: API и сокет идут по этому же адресу.

  Адрес живёт, пока жив этот процесс. Ctrl+C — закрыть туннель.
  Учтите: локальный резолвер этой машины не отдаёт *.trycloudflare.com,
  поэтому curl отсюда туннель не увидит — проверяйте с телефона или через
  curl --resolve. Из Telegram адрес открывается нормально.

TXT

wait "$TUNNEL_PID"
