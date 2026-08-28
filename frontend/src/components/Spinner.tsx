import styles from './Spinner.module.css';

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <div className={styles.wrap} role="status">
      <span className={styles.ring} />
      {label && <span>{label}</span>}
    </div>
  );
}
