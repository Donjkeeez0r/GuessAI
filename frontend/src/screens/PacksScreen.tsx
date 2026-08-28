import { useCallback, useEffect, useMemo, useState } from 'react';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { deletePack, fetchPacks } from '../api/endpoints';
import { useAsyncData } from '../hooks/useAsyncData';
import { useGoTo } from '../hooks/useGoTo';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import type { PackSummary } from '../types/api';
import styles from './PacksScreen.module.css';

type Tab = 'all' | 'mine';

const ALL_CATEGORIES = '__all__';

export function PacksScreen() {
  const goTo = useGoTo();
  const createRoom = useGameStore((state) => state.createRoom);
  const soloGame = useGameStore((state) => state.soloGame);
  const connected = useGameStore((state) => state.connected);
  const showToast = useUiStore((state) => state.showToast);

  const [tab, setTab] = useState<Tab>('all');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [selected, setSelected] = useState<PackSummary | null>(null);

  const loadPacks = useCallback(
    () => fetchPacks({ mine: tab === 'mine' }),
    [tab],
  );
  const {
    data: packs,
    loading,
    error,
    patch,
  } = useAsyncData<PackSummary[]>(tab, loadPacks);

  useEffect(() => {
    if (error) showToast(error);
  }, [error, showToast]);

  const categories = useMemo(() => {
    const unique = new Set((packs ?? []).map((pack) => pack.category));

    return [ALL_CATEGORIES, ...[...unique].sort((a, b) => a.localeCompare(b))];
  }, [packs]);

  const visiblePacks = useMemo(() => {
    const list = packs ?? [];

    return category === ALL_CATEGORIES
      ? list
      : list.filter((pack) => pack.category === category);
  }, [packs, category]);

  const switchTab = (next: Tab): void => {
    setTab(next);
    setCategory(ALL_CATEGORIES);
  };

  /** Пустой пак игру не начнёт — сервер ответит `PACK_EMPTY`. */
  const playablePack = (): PackSummary | null => {
    if (!selected) return null;

    if (selected._count.questions === 0) {
      showToast('В этом паке нет вопросов');
      return null;
    }

    return selected;
  };

  const startRoom = (isPublic: boolean): void => {
    const pack = playablePack();
    if (!pack) return;

    createRoom(pack.id, isPublic);
    setSelected(null);
  };

  const startSolo = (): void => {
    const pack = playablePack();
    if (!pack) return;

    soloGame(pack.id);
    setSelected(null);
  };

  const removePack = (pack: PackSummary): void => {
    deletePack(pack.id)
      .then(() => {
        setSelected(null);
        patch((current) => current.filter((item) => item.id !== pack.id));
        showToast('Пак удалён', 'success');
      })
      .catch((cause: unknown) => {
        showToast(
          cause instanceof Error ? cause.message : 'Не удалось удалить пак',
        );
      });
  };

  return (
    <Screen title="Паки" onBack={() => goTo('/')}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'all' ? styles.tabActive : ''}`}
          onClick={() => switchTab('all')}
        >
          Все
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'mine' ? styles.tabActive : ''}`}
          onClick={() => switchTab('mine')}
        >
          Мои
        </button>
      </div>

      {categories.length > 2 && (
        <div className={styles.categories}>
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={`${styles.chip} ${
                category === item ? styles.chipActive : ''
              }`}
              onClick={() => setCategory(item)}
            >
              {item === ALL_CATEGORIES ? 'Все категории' : item}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <Spinner label="Загружаем паки…" />
      ) : visiblePacks.length === 0 ? (
        <p className={styles.empty}>
          {tab === 'mine' ? 'Ты ещё не создал ни одного пака' : 'Паков пока нет'}
        </p>
      ) : (
        <div className={styles.list}>
          {visiblePacks.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className={styles.card}
              onClick={() => setSelected(pack)}
            >
              <div className={styles.cardTop}>
                <span className={styles.cardTitle}>{pack.title}</span>
                {pack.isAiGenerated && <span className={styles.aiBadge}>ИИ</span>}
              </div>
              <div className={styles.cardMeta}>
                <span>{pack.category}</span>
                <span>{pack._count.questions} вопросов</span>
                {!pack.isPublic && <span>приватный</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <Button variant="ghost" block onClick={() => goTo('/packs/new')}>
        + Создать пак
      </Button>

      {selected && (
        <div
          className={styles.sheetBackdrop}
          onClick={() => setSelected(null)}
          role="presentation"
        >
          <div
            className={styles.sheet}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label={selected.title}
          >
            <div className={styles.sheetTitle}>{selected.title}</div>
            <p className={styles.sheetHint}>
              Публичную комнату могут найти через быструю игру. В приватную
              войдут только по коду. Тренировка — игра в одиночку, без рейтинга.
            </p>
            <Button block disabled={!connected} onClick={() => startRoom(true)}>
              Публичная комната
            </Button>
            <Button
              variant="secondary"
              block
              disabled={!connected}
              onClick={() => startRoom(false)}
            >
              Приватная комната
            </Button>
            <Button
              variant="secondary"
              block
              disabled={!connected}
              onClick={startSolo}
            >
              Тренировка
            </Button>

            {tab === 'mine' && (
              <>
                <Button
                  variant="ghost"
                  block
                  onClick={() => goTo(`/packs/${selected.id}/edit`)}
                >
                  Редактировать
                </Button>
                <Button
                  variant="danger"
                  block
                  onClick={() => removePack(selected)}
                >
                  Удалить пак
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Screen>
  );
}
