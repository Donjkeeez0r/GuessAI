/**
 * Единая точка интеграции с Telegram.
 *
 * Основной путь — `@telegram-apps/sdk-react`. Он умеет падать в старых или
 * нестандартных вебвью, поэтому каждый вызов обёрнут в try/catch, а рядом
 * живёт фолбэк на `window.Telegram.WebApp` из официального скрипта
 * `telegram-web-app.js` (подключён в index.html). Наружу торчат только
 * функции этого модуля — компоненты про SDK ничего не знают.
 */
import {
  backButton,
  bindThemeParamsCssVars,
  bindViewportCssVars,
  expandViewport,
  hapticFeedbackImpactOccurred,
  hapticFeedbackNotificationOccurred,
  hapticFeedbackSelectionChanged,
  init,
  mountBackButton,
  mountThemeParamsSync,
  mountViewport,
  retrieveLaunchParams,
  retrieveRawInitData,
  shareStory,
  shareURL,
} from '@telegram-apps/sdk-react';

/** Минимальная форма legacy-API, которого достаточно для фолбэка. */
interface LegacyWebApp {
  initData?: string;
  initDataUnsafe?: { start_param?: string };
  ready?: () => void;
  expand?: () => void;
  themeParams?: Record<string, string>;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: string) => void;
    notificationOccurred: (type: string) => void;
    selectionChanged: () => void;
  };
  openTelegramLink?: (url: string) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: LegacyWebApp };
  }
}

function legacy(): LegacyWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/** Тихо выполняет действие: сбой интеграции с Telegram не должен ронять экран. */
function attempt<T>(action: () => T): T | null {
  try {
    return action();
  } catch {
    return null;
  }
}

let sdkInitialized = false;

/**
 * Инициализация до первого рендера. Вызывается один раз из main.tsx.
 * Возвращает `true`, если SDK поднялся; на `false` работают только фолбэки.
 */
export function initTelegram(): boolean {
  sdkInitialized = attempt(() => {
    init();
    return true;
  }) === true;

  if (sdkInitialized) {
    // Пробрасывает themeParams и размеры вьюпорта в CSS-переменные --tg-theme-*.
    attempt(() => mountThemeParamsSync());
    attempt(() => bindThemeParamsCssVars());
    attempt(() => {
      void mountViewport();
    });
    attempt(() => bindViewportCssVars());
    attempt(() => expandViewport());
    attempt(() => mountBackButton());
  }

  const webApp = legacy();

  if (webApp) {
    attempt(() => webApp.ready?.());
    attempt(() => webApp.expand?.());
  }

  applyLegacyThemeParams();

  return sdkInitialized;
}

/**
 * Старые вебвью не выставляют --tg-theme-* сами. Если после инициализации
 * переменная фона пуста, разворачиваем themeParams в CSS вручную.
 */
function applyLegacyThemeParams(): void {
  const root = document.documentElement;
  const alreadySet = getComputedStyle(root)
    .getPropertyValue('--tg-theme-bg-color')
    .trim();

  if (alreadySet) return;

  const params = legacy()?.themeParams;
  if (!params) return;

  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string') continue;
    root.style.setProperty(`--tg-theme-${key.replaceAll('_', '-')}`, value);
  }
}

const DEV_INIT_DATA_KEY = 'guessai.devInitData';

/**
 * Дев-режим: initData можно передать вкладке параметром `?initData=<...>`.
 * Значение запоминается в sessionStorage, поэтому вкладка держит своего
 * игрока — так в одном дев-сервере проверяются два игрока сразу.
 * В продакшен-сборке ветка вырезается по `import.meta.env.DEV`.
 */
function getDevInitDataOverride(): string | null {
  if (!import.meta.env.DEV) return null;

  try {
    const fromQuery = new URLSearchParams(window.location.search).get(
      'initData',
    );

    if (fromQuery) {
      window.sessionStorage.setItem(DEV_INIT_DATA_KEY, fromQuery);
      return fromQuery;
    }

    return window.sessionStorage.getItem(DEV_INIT_DATA_KEY);
  } catch {
    return null;
  }
}

/**
 * Сырая initData для `POST /auth/telegram`.
 * Вне Telegram — строка из `VITE_DEV_INIT_DATA`; если и она пуста, `null`.
 */
export function getRawInitData(): string | null {
  const fromSdk = attempt(() => retrieveRawInitData());
  if (fromSdk) return fromSdk;

  const fromLegacy = legacy()?.initData;
  if (fromLegacy) return fromLegacy;

  const override = getDevInitDataOverride();
  if (override) return override;

  const fromEnv = import.meta.env.VITE_DEV_INIT_DATA;
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/**
 * Параметр запуска из `t.me/<bot>?startapp=<roomId>`.
 * В браузере дополнительно читается `?startapp=` из адресной строки —
 * так deep link можно проверить без Telegram.
 */
export function getStartParam(): string | null {
  const fromSdk = attempt(
    () => retrieveLaunchParams().tgWebAppStartParam ?? null,
  );
  if (fromSdk) return fromSdk;

  const fromLegacy = legacy()?.initDataUnsafe?.start_param;
  if (fromLegacy) return fromLegacy;

  return new URLSearchParams(window.location.search).get('startapp');
}

/** Приложение реально открыто внутри Telegram, а не в обычном браузере. */
export function isInsideTelegram(): boolean {
  return Boolean(legacy()?.initData) || Boolean(attempt(() => retrieveRawInitData()));
}

// ───────────────────────────── BackButton ─────────────────────────────

/** Показывает системную кнопку «назад». Возвращает функцию снятия. */
export function showBackButton(onClick: () => void): () => void {
  const webApp = legacy();

  const sdkOff = attempt(() => {
    backButton.show();
    return backButton.onClick(onClick);
  });

  if (!sdkOff && webApp?.BackButton) {
    webApp.BackButton.onClick(onClick);
    webApp.BackButton.show();

    return () => {
      webApp.BackButton?.offClick(onClick);
      webApp.BackButton?.hide();
    };
  }

  return () => {
    attempt(() => sdkOff?.());
    attempt(() => backButton.hide());
  };
}

// ───────────────────────────── Подтверждение ─────────────────────────────

/**
 * Вопрос «да/нет» перед необратимым действием. В SDK 3.3.9 такого вызова нет,
 * поэтому основной путь — legacy `WebApp.showConfirm` из telegram-web-app.js,
 * а вне Telegram (дев-режим в браузере) остаётся window.confirm.
 */
export function confirmAction(message: string): Promise<boolean> {
  const webApp = legacy();

  // Вне Telegram у showConfirm нет собеседника: скрипт telegram-web-app.js
  // подключён всегда, но отвечать на его запрос некому — коллбэк может не
  // прийти вовсе. В браузере поэтому сразу window.confirm.
  if (isInsideTelegram() && webApp?.showConfirm) {
    return new Promise((resolve) => {
      const asked = attempt(() => {
        webApp.showConfirm?.(message, (confirmed) => resolve(confirmed));
        return true;
      });

      // Вызов мог не дойти до клиента Telegram — тогда коллбэка не будет
      // никогда, и экран остался бы висеть без ответа.
      if (!asked) resolve(window.confirm(message));
    });
  }

  return Promise.resolve(window.confirm(message));
}

// ───────────────────────────── Haptics ─────────────────────────────

export type HapticImpact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type HapticNotification = 'error' | 'success' | 'warning';

export function hapticImpact(style: HapticImpact = 'light'): void {
  const done = attempt(() => {
    hapticFeedbackImpactOccurred(style);
    return true;
  });

  if (!done) attempt(() => legacy()?.HapticFeedback?.impactOccurred(style));
}

export function hapticNotification(type: HapticNotification): void {
  const done = attempt(() => {
    hapticFeedbackNotificationOccurred(type);
    return true;
  });

  if (!done) attempt(() => legacy()?.HapticFeedback?.notificationOccurred(type));
}

export function hapticSelection(): void {
  const done = attempt(() => {
    hapticFeedbackSelectionChanged();
    return true;
  });

  if (!done) attempt(() => legacy()?.HapticFeedback?.selectionChanged());
}

// ───────────────────────────── Шэринг ─────────────────────────────

/** Приглашение в чат: диалог «поделиться ссылкой». */
export function shareLink(url: string, text: string): boolean {
  const done = attempt(() => {
    shareURL(url, text);
    return true;
  });

  if (done) return true;

  const fallback = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const opened = attempt(() => {
    legacy()?.openTelegramLink?.(fallback);
    return true;
  });

  if (opened) return true;

  return attempt(() => {
    window.open(fallback, '_blank', 'noopener');
    return true;
  }) === true;
}

/**
 * Публикация результата в Stories. Фон берётся из статики самого приложения
 * (`public/story-bg.png`) — Telegram требует публично доступный URL медиа.
 * Возвращает `false`, если сторис в этом клиенте недоступны.
 */
export function shareToStory(text: string, linkUrl: string): boolean {
  const mediaUrl = `${window.location.origin}/story-bg.png`;

  return (
    attempt(() => {
      shareStory(mediaUrl, {
        text,
        widgetLink: { url: linkUrl, name: 'Играть в GuessAI' },
      });
      return true;
    }) === true
  );
}
