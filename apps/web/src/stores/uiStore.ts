import { create } from 'zustand';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: 'default' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
}

type Theme = 'dark' | 'light';

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  authOpen: boolean;
  setAuthOpen: (v: boolean) => void;
  holdToSkip: boolean;
  setHoldToSkip: (v: boolean) => void;
}

let tid = 0;
const initialTheme = (): Theme => {
  try {
    return localStorage.getItem('orbit.theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme(),
  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('orbit.theme', theme);
    } catch {
      /* private mode */
    }
    set({ theme });
  },
  toasts: [],
  toast: (t) => {
    const id = ++tid;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.tone === 'error' ? 7000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
  authOpen: false,
  setAuthOpen: (authOpen) => set({ authOpen }),
  holdToSkip: (() => {
    try {
      return localStorage.getItem('orbit.confirmSkip') === '1';
    } catch {
      return false;
    }
  })(),
  setHoldToSkip: (v) => {
    try {
      localStorage.setItem('orbit.confirmSkip', v ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ holdToSkip: v });
  },
}));

export const toast = (t: Omit<Toast, 'id'>) => useUi.getState().toast(t);
