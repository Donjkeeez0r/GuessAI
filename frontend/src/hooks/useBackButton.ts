/** Системная кнопка «назад» Telegram на вложенных экранах. */
import { useEffect, useRef } from 'react';
import { showBackButton } from '../lib/telegram';

export function useBackButton(onBack: (() => void) | null): void {
  // Экраны передают инлайновую стрелку, её идентичность меняется каждый рендер.
  // Через ref кнопка регистрируется один раз за монтирование, а не на каждом
  // ROOM_UPDATED, иначе Telegram получает поток show/hide.
  const handlerRef = useRef(onBack);

  useEffect(() => {
    handlerRef.current = onBack;
  });

  const enabled = onBack !== null;

  useEffect(() => {
    if (!enabled) return;

    return showBackButton(() => handlerRef.current?.());
  }, [enabled]);
}
