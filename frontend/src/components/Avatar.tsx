import { useState } from 'react';
import styles from './Avatar.module.css';

interface AvatarProps {
  name: string;
  photoUrl: string | null;
  size?: number;
  dimmed?: boolean;
}

/** Аватар с фолбэком на первую букву имени: photoUrl приходит не всегда. */
export function Avatar({
  name,
  photoUrl,
  size = 40,
  dimmed = false,
}: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const letter = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <span
      className={`${styles.avatar} ${dimmed ? styles.dimmed : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {photoUrl && !broken ? (
        <img src={photoUrl} alt="" onError={() => setBroken(true)} />
      ) : (
        letter
      )}
    </span>
  );
}
