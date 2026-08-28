/**
 * Экран следует за фазой игры, а не за нажатиями: раундами управляет сервер,
 * поэтому переходы инициирует стор, а не кнопки.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useGoTo } from './useGoTo';
import { useGameStore } from '../store/gameStore';
import type { GamePhase } from '../store/gameStore';

const ROUTE_BY_PHASE: Partial<Record<GamePhase, string>> = {
  lobby: '/lobby',
  round: '/game',
  reveal: '/game',
  reconnecting: '/game',
  gameover: '/results',
};

export function useGameNavigation(): void {
  const phase = useGameStore((state) => state.phase);
  const goTo = useGoTo();
  const { pathname } = useLocation();

  useEffect(() => {
    const target = ROUTE_BY_PHASE[phase];

    if (!target || pathname === target) return;

    goTo(target, { replace: true });
  }, [phase, pathname, goTo]);
}
