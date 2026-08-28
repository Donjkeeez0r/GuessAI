import { useState } from 'react';
import { useGoTo } from '../hooks/useGoTo';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { PlayerRow } from '../components/PlayerRow';
import { SoundToggle } from '../components/SoundToggle';
import { PackPickerSheet } from '../components/PackPickerSheet';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { shareLink } from '../lib/telegram';
import styles from './LobbyScreen.module.css';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? '';

/** Пресеты повторяют белый список сервера — значения вне его он отвергает. */
const QUESTION_LIMITS: Array<{ value: number | null; label: string }> = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 15, label: '15' },
  { value: null, label: 'все' },
];

const ROUND_DURATIONS = [10000, 15000, 20000, 30000];

export function LobbyScreen() {
  const goTo = useGoTo();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const room = useGameStore((state) => state.room);
  const connected = useGameStore((state) => state.connected);
  const toggleReady = useGameStore((state) => state.toggleReady);
  const startGame = useGameStore((state) => state.startGame);
  const leaveRoom = useGameStore((state) => state.leaveRoom);
  const changePack = useGameStore((state) => state.changePack);
  const changeSettings = useGameStore((state) => state.changeSettings);
  const showToast = useUiStore((state) => state.showToast);
  const [packPickerOpen, setPackPickerOpen] = useState(false);

  const leave = (): void => {
    leaveRoom();
    goTo('/', { replace: true });
  };

  if (!room) {
    return (
      <Screen title="Лобби" onBack={leave}>
        <Spinner label="Подключаемся к комнате…" />
      </Screen>
    );
  }

  const me = room.players.find((player) => player.userId === userId);
  const isHost = room.hostUserId === userId;
  const connectedPlayers = room.players.filter((player) => player.connected);
  const everyoneReady =
    connectedPlayers.length > 0 &&
    connectedPlayers.every((player) => player.isReady);

  const inviteUrl = BOT_USERNAME
    ? `https://t.me/${BOT_USERNAME}?startapp=${room.roomId}`
    : `${window.location.origin}/?startapp=${room.roomId}`;

  const copyCode = (): void => {
    navigator.clipboard
      ?.writeText(room.roomId)
      .then(() => showToast('Код скопирован', 'success'))
      .catch(() => showToast('Не удалось скопировать код'));
  };

  const invite = (): void => {
    const shared = shareLink(
      inviteUrl,
      `Заходи в комнату ${room.roomId} — играем в GuessAI!`,
    );

    if (!shared) showToast('Не удалось открыть диалог приглашения');
  };

  return (
    <Screen title="Лобби" onBack={leave} actions={<SoundToggle />}>
      {!connected && (
        <div className={styles.banner}>Связь потеряна — переподключаемся…</div>
      )}

      <section className={styles.codeCard}>
        <span className={styles.codeLabel}>Код комнаты</span>
        <span className={styles.code}>{room.roomId}</span>
        <span className={styles.packTitle}>
          {room.packTitle} · {room.totalQuestions} вопросов ·{' '}
          {room.isPublic ? 'публичная' : 'приватная'}
        </span>
        <div className={styles.codeActions}>
          <Button variant="secondary" size="sm" onClick={copyCode}>
            Копировать
          </Button>
          <Button variant="secondary" size="sm" onClick={invite}>
            Пригласить
          </Button>
          {isHost && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!connected}
              onClick={() => setPackPickerOpen(true)}
            >
              Сменить пак
            </Button>
          )}
        </div>
      </section>

      <section className={styles.settings}>
        <div className={styles.settingsRow}>
          <span className={styles.settingsLabel}>Вопросов</span>
          <div className={styles.chips}>
            {QUESTION_LIMITS.map((option) => (
              <button
                key={option.label}
                type="button"
                className={`${styles.chip} ${
                  room.questionLimit === option.value ? styles.chipActive : ''
                }`}
                // Гость видит те же чипсы, но только читает: настройки — за
                // хостом. Пресет крупнее пака гасим, он всё равно даст пак целиком.
                disabled={
                  !isHost ||
                  !connected ||
                  (option.value !== null &&
                    option.value > room.packQuestionCount)
                }
                onClick={() => changeSettings({ questionLimit: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.settingsRow}>
          <span className={styles.settingsLabel}>На ответ</span>
          <div className={styles.chips}>
            {ROUND_DURATIONS.map((ms) => (
              <button
                key={ms}
                type="button"
                className={`${styles.chip} ${
                  room.roundDurationMs === ms ? styles.chipActive : ''
                }`}
                disabled={!isHost || !connected}
                onClick={() => changeSettings({ roundDurationMs: ms })}
              >
                {ms / 1000}с
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className={styles.sectionTitle}>
        <span>Игроки</span>
        <span>{room.players.length}</span>
      </div>

      <ul className={styles.players}>
        {room.players.map((player) => (
          <PlayerRow
            key={player.userId}
            player={player}
            isMe={player.userId === userId}
          />
        ))}
      </ul>

      <div className={styles.footer}>
        <Button
          variant={me?.isReady ? 'secondary' : 'primary'}
          size="lg"
          block
          disabled={!connected}
          onClick={toggleReady}
        >
          {me?.isReady ? 'Не готов' : 'Готов'}
        </Button>

        {isHost ? (
          <Button
            block
            disabled={!connected || !everyoneReady}
            onClick={startGame}
          >
            {everyoneReady ? 'Начать игру' : 'Ждём остальных…'}
          </Button>
        ) : (
          <p className={styles.waitHint}>Игру начинает хост</p>
        )}

        <Button variant="danger" block onClick={leave}>
          Выйти
        </Button>
      </div>

      {packPickerOpen && (
        <PackPickerSheet
          currentPackId={room.packId}
          onPick={(packId) => {
            changePack(packId);
            setPackPickerOpen(false);
          }}
          onClose={() => setPackPickerOpen(false)}
        />
      )}
    </Screen>
  );
}
