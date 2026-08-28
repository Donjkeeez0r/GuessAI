/**
 * Выбор пака для комнаты, не покидая лобби: `useGameNavigation` в фазе
 * `lobby` возвращает на `/lobby` любой другой маршрут, поэтому отдельным
 * экраном список сделать нельзя.
 */
import { useCallback, useEffect } from 'react';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { fetchPacks } from '../api/endpoints';
import { useAsyncData } from '../hooks/useAsyncData';
import { useUiStore } from '../store/uiStore';
import type { PackSummary } from '../types/api';
import styles from './PackPickerSheet.module.css';

interface Props {
  /** Пак комнаты сейчас — помечается в списке и не предлагается к выбору. */
  currentPackId: string;
  onPick: (packId: string) => void;
  onClose: () => void;
}

/** Публичные паки плюс свои: приватные чужие сервер всё равно не отдаст. */
function loadAvailablePacks(): Promise<PackSummary[]> {
  return Promise.all([fetchPacks({}), fetchPacks({ mine: true })]).then(
    ([publicPacks, myPacks]) => {
      const byId = new Map(publicPacks.map((pack) => [pack.id, pack]));

      myPacks.forEach((pack) => byId.set(pack.id, pack));

      return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
    },
  );
}

export function PackPickerSheet({ currentPackId, onPick, onClose }: Props) {
  const showToast = useUiStore((state) => state.showToast);
  const loader = useCallback(() => loadAvailablePacks(), []);
  const { data: packs, loading, error } = useAsyncData<PackSummary[]>(
    'pack-picker',
    loader,
  );

  useEffect(() => {
    if (error) showToast(error);
  }, [error, showToast]);

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.sheet}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Выбор пака"
      >
        <div className={styles.title}>Сменить пак</div>
        <p className={styles.hint}>
          Всем игрокам придётся заново подтвердить готовность.
        </p>

        {loading && <Spinner label="Загружаем паки…" />}

        {packs && (
          <div className={styles.list}>
            {packs.map((pack) => {
              const isCurrent = pack.id === currentPackId;
              const isEmpty = pack._count.questions === 0;

              return (
                <button
                  key={pack.id}
                  type="button"
                  className={styles.card}
                  disabled={isCurrent || isEmpty}
                  onClick={() => onPick(pack.id)}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardTitle}>{pack.title}</span>
                    {pack.isAiGenerated && (
                      <span className={`${styles.badge} ${styles.badgeAi}`}>ИИ</span>
                    )}
                    {isCurrent && <span className={styles.badge}>текущий</span>}
                  </div>
                  <div className={styles.cardMeta}>
                    <span>{pack.category}</span>
                    <span>{pack._count.questions} вопросов</span>
                    {!pack.isPublic && <span>приватный</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <Button variant="ghost" block onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
