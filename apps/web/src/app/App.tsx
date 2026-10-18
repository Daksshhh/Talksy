import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { startAuth } from '@/stores/authStore';
import { chatClient } from '@/services/chatClient';
import { Toaster } from '@/components/ui/Toaster';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { FullPageSpinner } from '@/components/layout/FullPageSpinner';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { configOk } from '@/lib/env';
import { LandingPage } from '@/pages/LandingPage';
import { ConfigErrorPage } from '@/pages/ConfigErrorPage';

// Lazy-load everything that isn't the landing page.
const AuthCallbackPage = lazy(() => import('@/pages/AuthCallbackPage'));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'));
const DiscoverPage = lazy(() => import('@/pages/app/DiscoverPage'));
const ChatPage = lazy(() => import('@/pages/app/ChatPage'));
const FriendsPage = lazy(() => import('@/pages/app/FriendsPage'));
const InboxPage = lazy(() => import('@/pages/app/InboxPage'));
const HistoryPage = lazy(() => import('@/pages/app/HistoryPage'));
const HistoryDetailPage = lazy(() => import('@/pages/app/HistoryDetailPage'));
const NotificationsPage = lazy(() => import('@/pages/app/NotificationsPage'));
const ProfilePage = lazy(() => import('@/pages/app/ProfilePage'));
const SettingsPage = lazy(() => import('@/pages/app/SettingsPage'));
const PublicProfilePage = lazy(() => import('@/pages/app/PublicProfilePage'));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'));
const LegalPage = lazy(() => import('@/pages/legal/LegalPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: 0 },
  },
});

export function App() {
  useVisualViewport();
  useEffect(
    () =>
      startAuth(() => {
        chatClient.shutdown();
        queryClient.clear();
      }),
    [],
  );

  if (!configOk) return <ConfigErrorPage />;

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2">
          Skip to content
        </a>
        <Suspense fallback={<FullPageSpinner />}>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route index element={<LandingPage />} />
              <Route path="terms" element={<LegalPage doc="terms" />} />
              <Route path="privacy" element={<LegalPage doc="privacy" />} />
              <Route path="guidelines" element={<LegalPage doc="guidelines" />} />
              <Route path="contact" element={<LegalPage doc="contact" />} />
              <Route path="report-abuse" element={<LegalPage doc="report" />} />
            </Route>
            <Route path="auth/callback" element={<AuthCallbackPage />} />
            <Route path="onboarding" element={<RequireAuth allowNotOnboarded><OnboardingPage /></RequireAuth>} />
            <Route path="app" element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route index element={<DiscoverPage />} />
              <Route path="chat" element={<ChatPage />} />
              <Route path="friends" element={<FriendsPage />} />
              <Route path="inbox" element={<InboxPage />} />
              <Route path="inbox/:conversationId" element={<InboxPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="history/:sessionId" element={<HistoryDetailPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="u/:userId" element={<PublicProfilePage />} />
            </Route>
            <Route path="admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
            <Route path="login" element={<Navigate to="/?auth=1" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
        <AuthDialog />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
