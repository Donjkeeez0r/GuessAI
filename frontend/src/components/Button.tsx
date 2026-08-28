import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { hapticImpact } from '../lib/telegram';
import { playClick, unlockAudio } from '../lib/sound';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  children: ReactNode;
}

/**
 * Базовая кнопка. Каждый тап заодно «размораживает» AudioContext:
 * мобильные браузеры разрешают звук только после жеста пользователя.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    size !== 'md' ? styles[size] : '',
    block ? styles.block : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={(event) => {
        unlockAudio();
        playClick();
        hapticImpact('light');
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
