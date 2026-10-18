import { Moon, Sun } from 'lucide-react';
import { useUi } from '@/stores/uiStore';

export function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button onClick={() => setTheme(next)} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Switch to ${next} mode`}>
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
