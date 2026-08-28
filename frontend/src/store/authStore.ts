/**
 * Авторизация. `user.id` кладётся в стор сразу из ответа `POST /auth/telegram`:
 * он нужен постоянно, чтобы отличать «это я» в списках игроков, лидерборде
 * и `ratingChanges`.
 */
import { create } from 'zustand';
import { setAuthToken } from '../api/client';
import { loginWithTelegram } from '../api/endpoints';
import { getRawInitData } from '../lib/telegram';
import type { AuthUser } from '../types/api';

export type AuthStatus =
  | 'idle'
  | 'loading'
  /** initData нет ни от Telegram, ни из VITE_DEV_INIT_DATA. */
  | 'no-init-data'
  | 'error'
  | 'authorized';

interface AuthState {
  status: AuthStatus;
  token: string | null;
  user: AuthUser | null;
  error: string | null;
  authorize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  token: null,
  user: null,
  error: null,

  authorize: async () => {
    const initData = getRawInitData();

    if (!initData) {
      set({ status: 'no-init-data', error: null });
      return;
    }

    set({ status: 'loading', error: null });

    try {
      const { token, user } = await loginWithTelegram(initData);

      setAuthToken(token);
      set({ status: 'authorized', token, user, error: null });
    } catch (error) {
      setAuthToken(null);
      set({
        status: 'error',
        token: null,
        user: null,
        error:
          error instanceof Error
            ? error.message
            : 'Не удалось авторизоваться в Telegram',
      });
    }
  },
}));

/** `userId` текущего пользователя для сравнений «это я». */
export function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}
