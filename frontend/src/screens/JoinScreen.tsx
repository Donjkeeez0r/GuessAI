import { useState } from 'react';
import { useGoTo } from '../hooks/useGoTo';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { useGameStore } from '../store/gameStore';
import styles from './JoinScreen.module.css';

const CODE_LENGTH = 6;

/** Вход по коду комнаты. Ошибки ROOM_NOT_FOUND / ROOM_IN_PROGRESS покажет тост. */
export function JoinScreen() {
  const goTo = useGoTo();
  const joinRoom = useGameStore((state) => state.joinRoom);
  const joining = useGameStore((state) => state.joining);
  const connected = useGameStore((state) => state.connected);

  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);

  const isValid = code.length === CODE_LENGTH;

  const submit = (): void => {
    setTouched(true);

    if (!isValid) return;

    joinRoom(code);
  };

  return (
    <Screen title="Вход по коду" onBack={() => goTo('/')}>
      <div className={styles.wrap}>
        <p className={styles.hint}>
          Введи {CODE_LENGTH} символов кода, который показывает хост в лобби.
        </p>

        <input
          className={`${styles.code} ${touched && !isValid ? styles.invalid : ''}`}
          value={code}
          maxLength={CODE_LENGTH}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder="ABC123"
          aria-label="Код комнаты"
          onChange={(event) => {
            setCode(
              event.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, CODE_LENGTH),
            );
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />

        <Button
          size="lg"
          block
          disabled={joining || !connected}
          onClick={submit}
        >
          {joining ? 'Входим…' : 'Войти'}
        </Button>
      </div>
    </Screen>
  );
}
