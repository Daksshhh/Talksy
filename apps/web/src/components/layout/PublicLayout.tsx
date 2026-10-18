import { useEffect } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { useUi } from '@/stores/uiStore';
import { useAuth } from '@/stores/authStore';
import { ThemeToggle } from './ThemeToggle';
import { Footer } from './Footer';

export function PublicLayout() {
  const setAuthOpen = useUi((s) => s.setAuthOpen);
  const status = useAuth((s) => s.status);
  const [params] = useSearchParams();
  const loc = useLocation();
  useEffect(() => {
    if (params.get('auth') === '1' && status === 'signedOut') setAuthOpen(true);
  }, [params, status, setAuthOpen]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="glass sticky top-0 z-30 border-b border-border/50 pt-safe">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" aria-label="Home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-1.5 sm:gap-2" aria-label="Account">
            <ThemeToggle />
            {status === 'signedIn' ? (
              <Link to="/app">
                <Button size="sm">Open app</Button>
              </Link>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setAuthOpen(true)}>
                  Log in
                </Button>
                <Button size="sm" onClick={() => setAuthOpen(true)} className="hidden sm:inline-flex">
                  Start Chat
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
