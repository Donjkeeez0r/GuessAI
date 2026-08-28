import { useCallback, useEffect } from 'react';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { Spinner } from '../components/Spinner';
import { SoundToggle } from '../components/SoundToggle';
import { fetchProfile } from '../api/endpoints';
import { useAsyncData } from '../hooks/useAsyncData';
import { useGoTo } from '../hooks/useGoTo';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import type { UserProfile } from '../types/api';
import styles from './HomeScreen.module.css';

export function HomeScreen() {
  const goTo = useGoTo();
  const user = useAuthStore((state) => state.user);
  const quickMatch = useGameStore((state) => state.quickMatch);
  const joining = useGameStore((state) => state.joining);
  const connected = useGameStore((state) => state.connected);
  const showToast = useUiStore((state) => state.showToast);

  const loadProfile = useCallback(() => fetchProfile(), []);
  const { data: profile, loading, error } = useAsyncData<UserProfile>(
    'profile',
    loadProfile,
  );

  useEffect(() => {
    if (error) showToast(error);
  }, [error, showToast]);

  const displayName =
    profile?.username ?? user?.username ?? user?.firstName ?? '';

  return (
    <Screen actions={<SoundToggle />}>
      <div className={styles.brand}>GuessAI</div>

      {loading ? (
        <Spinner label="Загружаем профиль…" />
      ) : (
        <>
          <section className={styles.profile}>
            <Avatar
              name={displayName}
              photoUrl={profile?.photoUrl ?? user?.photoUrl ?? null}
              size={56}
            />
            <div className={styles.identity}>
              <div className={styles.name}>{displayName}</div>
              <div className={styles.rating}>
                {profile?.rating ?? user?.rating ?? 0} рейтинга
              </div>
            </div>
          </section>

          <section className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{profile?.totalGames ?? 0}</span>
              <span className={styles.statLabel}>игр</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{profile?.wins ?? 0}</span>
              <span className={styles.statLabel}>побед</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{profile?.totalPacks ?? 0}</span>
              <span className={styles.statLabel}>паков</span>
            </div>
          </section>
        </>
      )}

      <div className={styles.actions}>
        <Button
          size="lg"
          block
          disabled={joining || !connected}
          onClick={quickMatch}
        >
          {joining ? 'Ищем комнату…' : '⚡ Быстрая игра'}
        </Button>
        <Button
          variant="secondary"
          block
          disabled={!connected}
          onClick={() => goTo('/packs')}
        >
          Играть с друзьями
        </Button>

        <div className={styles.secondaryGrid}>
          <Button variant="secondary" onClick={() => goTo('/join')}>
            Войти по коду
          </Button>
          <Button variant="secondary" onClick={() => goTo('/packs/new')}>
            Создать пак
          </Button>
        </div>

        <div className={styles.secondaryGrid}>
          <Button variant="ghost" onClick={() => goTo('/history')}>
            Мои игры
          </Button>
          <Button variant="ghost" onClick={() => goTo('/leaderboard')}>
            Лидерборд
          </Button>
        </div>
      </div>
    </Screen>
  );
}
