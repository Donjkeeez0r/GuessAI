/**
 * Загрузка данных по REST: запрос при смене ключа, отмена при размонтировании
 * и состояние загрузки, выведенное из ключа, а не из отдельного setState.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncResult<T> {
  key: string;
  data: T | null;
  error: string | null;
}

export interface AsyncData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Повторить запрос с тем же ключом. */
  reload: () => void;
  /** Локально поправить загруженные данные (например, убрать удалённый пак). */
  patch: (update: (current: T) => T) => void;
}

export function useAsyncData<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
): AsyncData<T> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<AsyncResult<T>>({
    key: '',
    data: null,
    error: null,
  });

  // Загрузчик держим в ref: его пересоздание в рендере не должно перезапускать
  // запрос. Эффект синхронизации объявлен раньше загрузки, поэтому к моменту
  // её запуска в ref уже лежит актуальная функция.
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const resultKey = `${key}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();

    loaderRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ key: resultKey, data, error: null });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        setResult({
          key: resultKey,
          data: null,
          error:
            error instanceof Error ? error.message : 'Не удалось загрузить данные',
        });
      });

    return () => controller.abort();
  }, [resultKey]);

  const patch = useCallback((update: (current: T) => T) => {
    setResult((current) =>
      current.data === null ? current : { ...current, data: update(current.data) },
    );
  }, []);

  return {
    data: result.key === resultKey ? result.data : null,
    loading: result.key !== resultKey,
    error: result.key === resultKey ? result.error : null,
    reload: useCallback(() => setAttempt((value) => value + 1), []),
    patch,
  };
}
