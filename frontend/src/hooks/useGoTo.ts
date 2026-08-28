/**
 * `navigate` из react-router v7 возвращает промис. Он нам не нужен нигде,
 * поэтому переходы идут через эту обёртку с обычной void-сигнатурой.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavigateOptions } from 'react-router-dom';

export type GoTo = (to: string, options?: NavigateOptions) => void;

export function useGoTo(): GoTo {
  const navigate = useNavigate();

  return useCallback(
    (to, options) => {
      void navigate(to, options);
    },
    [navigate],
  );
}
