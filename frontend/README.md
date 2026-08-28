# GuessAI — фронтенд

Telegram Mini App: реалтайм-викторина на React 19 + Vite + TypeScript.
Контракт с бэкендом — `../CONTRACT.md`, это источник правды.

## Стек

- React 19, Vite, TypeScript (строгий режим, без `any`)
- zustand — состояние комнаты и игры
- socket.io-client v4 — реалтайм
- react-router-dom v7 — навигация
- @telegram-apps/sdk-react — initData, тема, BackButton, HapticFeedback, шэринг
  (с фолбэком на `window.Telegram.WebApp` из `telegram-web-app.js`)
- CSS Modules + токены в `src/styles/tokens.css`

## Запуск

```bash
# 1. Инфраструктура и бэкенд
cd ..
docker compose up -d db redis backend        # API на http://localhost:3000

# либо бэкенд из исходников:
docker compose up -d db redis
cd backend && pnpm install && pnpm start:dev

# 2. Фронтенд
cd frontend
pnpm install
cp .env.example .env.local                   # и заполнить VITE_DEV_INIT_DATA
pnpm dev                                     # http://localhost:5173
```

> В `docker-compose.yaml` заданы `name: guessai` и явные `image: guessai-frontend`
> и `image: guessai-backend`. Без них compose брал бы имена по каталогу проекта
> (`main`) и мог перезаписать образы постороннего проекта с тем же именем
> каталога. Контейнеры называются `guessai-*`, том базы — `guessai_postgres_main`.

Переменные (`.env.local`, он в `.gitignore`):

| Переменная | Смысл |
|---|---|
| `VITE_API_URL` | абсолютный адрес бэкенда. **Оставьте пустым**: тогда запросы идут на origin dev-сервера, а `vite.config.ts` проксирует их на бэкенд. Заполнять только для обращения к бэкенду в обход прокси |
| `VITE_DEV_INIT_DATA` | реальная `initData` для отладки вне Telegram |
| `VITE_BOT_USERNAME` | username бота для ссылок `t.me/<bot>?startapp=<roomId>` |

## Отладка вне Telegram

`initData` подписана токеном бота, подделать её нельзя — сервер отвергнет мусор.
Без неё приложение показывает экран «Откройте приложение через Telegram», а не
белый экран.

Как снять реальную `initData`:

1. Открыть Mini App в **Telegram Desktop**, вызвать контекстное меню → «Inspect
   Element» (в настройках Telegram Desktop включить экспериментальную опцию
   `Enable webview inspecting`).
2. В консоли выполнить `Telegram.WebApp.initData` и скопировать строку.
3. Положить её в `.env.local`:
   `VITE_DEV_INIT_DATA=query_id=...&user=...&auth_date=...&signature=...&hash=...`

Строка живёт **24 часа** — по истечении снять заново.

**Два игрока в одном дев-сервере.** В дев-режиме `initData` можно передать
вкладке параметром: `http://localhost:5173/?initData=<urlencoded>`. Значение
запоминается в `sessionStorage` этой вкладки, так что две вкладки держат разных
игроков. В продакшен-сборке эта ветка вырезается (`import.meta.env.DEV`).

## Тест внутри Telegram

Собранный фронт в Docker (рекомендуется — ближе к реальности):

```bash
cd .. && docker compose up -d       # фронт на :8080, API проксируется через него
./scripts/tunnel.sh                 # поднимет туннель и напечатает адрес
```

Либо dev-сервер:

```bash
pnpm dev --host                 # слушать на всех интерфейсах
cloudflared tunnel --url http://localhost:5173     # или: ngrok http 5173
```

Туннель нужен **один**: API и сокет живут на том же origin, что и страница.

Полученный https-URL указать в BotFather: `/mybots` → бот → *Bot Settings* →
*Configure Mini App*. Без этого deep link `startapp` не работает. Затем открыть
бота в Telegram — Mini App подхватит настоящую `initData`, тему и BackButton.

Адрес quick-туннеля меняется при каждом запуске, поэтому шаг с BotFather
придётся повторять. Пересобирать фронт при этом не нужно — адрес бэкенда
в бандл не попадает.

Deep link для приглашений: `https://t.me/<bot>?startapp=<roomId>` — приложение
сразу шлёт `JOIN_ROOM` с этим кодом и ведёт в лобби, минуя Home.

## Проверки

```bash
pnpm build          # tsc --noEmit && vite build
pnpm exec tsc --noEmit
pnpm lint
```

`tsconfig` намеренно схлопнут в один файл. При стандартном Vite-сплите
(`files: []` + `references`) команда `tsc --noEmit` не проверяет ничего и
всегда возвращает 0 — то есть тихо перестаёт быть проверкой.

## Структура

```
src/
  api/         тонкая обёртка над fetch и все REST-вызовы контракта
  components/  переиспользуемый UI (кнопка, аватар, таймер, лидерборд, тосты)
  hooks/       таймер раунда, озвучка, загрузка данных, навигация по фазе
  lib/         интеграция с Telegram и синтез звуковых эффектов
  screens/     экраны приложения (см. таблицу ниже)
  socket/      единственный сокет приложения
  store/       zustand: авторизация, игра, UI
  styles/      дизайн-токены и глобальные стили
  types/api.ts типы контракта — единственное место, где описана форма данных
```

| Экран | Что делает |
|---|---|
| `SplashScreen` | авторизация по `initData`; вне Telegram — понятная заглушка, а не белый экран |
| `HomeScreen` | профиль, счётчики, вход в быструю игру и во все разделы |
| `PacksScreen` | список паков, вкладки «все» / «мои», шторка выбора режима |
| `PackEditorScreen` | создание и правка пака, генерация через Gemini |
| `JoinScreen` | вход в комнату по шестизначному коду |
| `LobbyScreen` | игроки, готовность, приглашение, смена пака и настройки партии |
| `GameScreen` | вопрос, таймер, серия, раскрытие ответа, промежуточный лидерборд |
| `ResultsScreen` | подиум, изменение рейтинга, реванш, шэринг |
| `HistoryScreen` | сыгранные партии |
| `LeaderboardScreen` | глобальный топ с закреплённой строкой своего места |

Ключевые правила, зафиксированные в коде:

- **Раундами управляет сервер.** Клиент не шлёт «дальше», экран следует за
  фазой стора (`hooks/useGameNavigation.ts`).
- **Таймер синхронизируется по `endsAt`.** Смещение часов считается на каждом
  `ROUND_START` как `endsAt - durationMs - Date.now()`, остаток — как
  `endsAt - (Date.now() + offset)` (`hooks/useRoundTimer.ts`).
- **Личность не уходит в payload** — сервер берёт `userId` из JWT.
- **Правильные ответы приходят только в `ROUND_END`**; `GET /pack/:id` их не
  отдаёт, поэтому при редактировании чужих вопросов правильный вариант нужно
  отметить заново.
- **Сокет один на приложение**, подписки ставятся один раз в
  `store/gameStore.ts` → `bindGameSocket`.
- **Своя серия держится в сторе (`myStreak`), а не читается из `room.players`.**
  `ROOM_UPDATED` во время партии приходит не на каждый ответ, поэтому значение
  в комнате было бы устаревшим. Стор обновляет серию по своему результату из
  `ROUND_END` и обнуляет её на первом раунде партии.
- **Выбор пака и настройки живут внутри `LobbyScreen`.** Отдельным экраном их
  сделать нельзя: `useGameNavigation` в фазе `lobby` возвращает на `/lobby`
  любой другой маршрут.
- **Пресеты настроек дублируют белый список сервера.** Значения вне него сервер
  отвергает молча, поэтому списки в `LobbyScreen.tsx` и `game.service.ts`
  обязаны совпадать.

## Оформление

Все цвета, отступы, скругления и тайминги — токены в `src/styles/tokens.css`.
Поверхности и текст наследуются от темы Telegram (`--tg-theme-*`), поэтому
приложение выглядит нативно и в светлой, и в тёмной теме. **У каждой переменной
темы обязателен фолбэк:** вне Telegram эти переменные не заданы, и без фолбэка
экран будет пустым.

Поверх темы лежит один брендовый акцент (`--brand`) и семантика ответов
(`--success` / `--danger`). Анимации завязаны на `--dur-*`, а блок
`@media (prefers-reduced-motion: reduce)` обнуляет эти длительности — то есть
достаточно пользоваться токенами, чтобы уважать настройку системы.

Компоненты стилизуются через CSS Modules; глобально живут только сброс,
типографика и общие `@keyframes` (`fade-in`, `rise-in`, `pop-in`, `shake`).

## Озвучка вопросов

`audioUrl` — прямая ссылка на Google TTS, аудио играется через `new Audio(url)`.

Две ловушки, обе проверены на живом стеке:

1. **`translate.google.com/translate_tts` отдаёт 404 на любой запрос с
   заголовком `Referer`.** Браузер всегда шлёт `Referer` для медиа, а свойства
   `referrerPolicy` у медиаэлементов **не существует** — присваивание
   `audio.referrerPolicy` молча игнорируется. Лечится только политикой
   документа: в `index.html` стоит `<meta name="referrer" content="no-referrer">`.
   Удалить эту строку — сломать озвучку целиком.
2. **Через `fetch` эту ссылку не забрать** — Google не отдаёт CORS-заголовки.
   Поэтому только `new Audio(url)`, без предзагрузки и кеша.

## Сборка в Docker

```bash
docker compose up -d --build frontend        # http://localhost:8080
```

`VITE_API_URL` вшивается на этапе сборки build-аргументом из `docker-compose.yaml`
и по умолчанию пуст: запросы идут на origin фронта, а `nginx.conf` проксирует
`/api/*` (срезая префикс) и `/socket.io/` на `backend:3000` — с апгрейдом
WebSocket и увеличенным `proxy_read_timeout`, чтобы соединение жило всю партию.
