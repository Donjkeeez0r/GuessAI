import { useUiStore } from '../store/uiStore';
import { unlockAudio } from '../lib/sound';
import styles from './SoundToggle.module.css';

/** Переключатель звука. Состояние хранится в localStorage (см. lib/sound). */
export function SoundToggle() {
  const soundEnabled = useUiStore((state) => state.soundEnabled);
  const toggleSound = useUiStore((state) => state.toggleSound);

  return (
    <button
      type="button"
      className={`${styles.toggle} ${soundEnabled ? '' : styles.off}`}
      onClick={() => {
        unlockAudio();
        toggleSound();
      }}
      aria-label={soundEnabled ? 'Выключить звук' : 'Включить звук'}
      aria-pressed={soundEnabled}
    >
      {soundEnabled ? '🔊' : '🔇'}
    </button>
  );
}
