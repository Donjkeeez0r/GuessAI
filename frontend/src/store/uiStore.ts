/** Общий UI-стор: тосты и настройка звука. */
import { create } from 'zustand';
import { isSoundEnabled, setSoundEnabled } from '../lib/sound';

export type ToastTone = 'error' | 'info' | 'success';

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

interface UiState {
  toasts: Toast[];
  soundEnabled: boolean;
  showToast: (text: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
  toggleSound: () => void;
}

let nextToastId = 1;

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  soundEnabled: isSoundEnabled(),

  showToast: (text, tone = 'error') => {
    const toast: Toast = { id: nextToastId++, text, tone };

    set((state) => ({ toasts: [...state.toasts, toast] }));

    window.setTimeout(() => get().dismissToast(toast.id), 4000);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
  },

  toggleSound: () => {
    const next = !get().soundEnabled;

    setSoundEnabled(next);
    set({ soundEnabled: next });
  },
}));

/** Показать тост из немодульного кода (обработчики сокета). */
export function toast(text: string, tone: ToastTone = 'error'): void {
  useUiStore.getState().showToast(text, tone);
}
