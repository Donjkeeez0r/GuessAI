/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Абсолютный адрес бэкенда. Пусто или не задано — API берётся с origin
   * фронта через прокси (nginx в контейнере, server.proxy в dev).
   */
  readonly VITE_API_URL?: string;
  /** Реальная initData из Telegram для отладки вне Telegram. */
  readonly VITE_DEV_INIT_DATA?: string;
  /** Username бота без «@» — для ссылок t.me/<bot>?startapp=<roomId>. */
  readonly VITE_BOT_USERNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
