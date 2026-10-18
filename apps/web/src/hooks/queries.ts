import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FriendRequestView,
  FriendSummary,
  HistoryDetail,
  HistoryItem,
  MyProfile,
  NotificationView,
  Page,
  PresenceCountResponse,
  PresenceStatus,
  ProfilePatch,
  PublicProfile,
} from '@orbit/shared';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/authStore';

export const qk = {
  me: ['me'] as const,
  friends: ['friends'] as const,
  requests: ['friendRequests'] as const,
  inbox: ['inbox'] as const,
  unread: ['unread'] as const,
  notifications: ['notifications'] as const,
  presenceCount: ['presenceCount'] as const,
  friendPresence: ['friendPresence'] as const,
  history: ['history'] as const,
  historyItem: (id: string) => ['history', id] as const,
  dm: (id: string) => ['dm', id] as const,
  blocks: ['blocks'] as const,
  profile: (id: string) => ['profile', id] as const,
};

const useSignedIn = () => useAuth((s) => s.status === 'signedIn');

export function useMe() {
  const enabled = useSignedIn();
  return useQuery({ queryKey: qk.me, queryFn: () => api<MyProfile>('/api/me'), enabled, staleTime: 60_000 });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => api<MyProfile>('/api/me', { method: 'PATCH', body: patch }),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}

export function useFriends() {
  const enabled = useSignedIn();
  return useQuery({ queryKey: qk.friends, queryFn: () => api<{ items: FriendSummary[] }>('/api/friends').then((r) => r.items), enabled });
}

export function useFriendRequests() {
  const enabled = useSignedIn();
  return useQuery({ queryKey: qk.requests, queryFn: () => api<{ items: FriendRequestView[] }>('/api/friend-requests').then((r) => r.items), enabled });
}

export function useFriendPresence() {
  const enabled = useSignedIn();
  return useQuery({
    queryKey: qk.friendPresence,
    queryFn: () => api<{ presence: Record<string, PresenceStatus> }>('/api/presence/friends').then((r) => r.presence),
    enabled,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function usePresenceCount(enabled = true) {
  return useQuery({
    queryKey: qk.presenceCount,
    queryFn: () => api<PresenceCountResponse>('/api/presence/count', { auth: false }),
    enabled,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export interface InboxItem {
  conversationId: string;
  peerId: string;
  peerName: string | null;
  peerAvatarSeed: string | null;
  peerAvatarStyle: string | null;
  isFriend: boolean;
  isBlocked: boolean;
  lastMessageAt: string | null;
  peerLastReadAt: string;
  lastMessage: { body: string; fromMe: boolean; createdAt: string } | null;
  unread: number;
}

export function useInbox() {
  const enabled = useSignedIn();
  return useQuery({
    queryKey: qk.inbox,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inbox');
      if (error) throw error;
      return (data ?? []) as InboxItem[];
    },
  });
}

export function useUnread() {
  const enabled = useSignedIn();
  return useQuery({
    queryKey: qk.unread,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_unread_summary');
      if (error) throw error;
      return data as { notifications: number; dms: number; friendRequests: number };
    },
    staleTime: 15_000,
  });
}

interface NotificationRow {
  id: string;
  type: NotificationView['type'];
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export function useNotifications() {
  const enabled = useSignedIn();
  return useQuery({
    queryKey: qk.notifications,
    enabled,
    queryFn: async (): Promise<NotificationView[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id,type,title,body,data,read_at,created_at')
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data as NotificationRow[]).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, data: n.data, readAt: n.read_at, createdAt: n.created_at }));
    },
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | null) => {
      const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids });
      if (error) throw error;
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: qk.notifications });
      const prev = qc.getQueryData<NotificationView[]>(qk.notifications);
      const now = new Date().toISOString();
      qc.setQueryData<NotificationView[]>(qk.notifications, (old) => old?.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.notifications, ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: qk.unread });
    },
  });
}

export function useHistory() {
  const enabled = useSignedIn();
  return useInfiniteQuery({
    queryKey: qk.history,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page<HistoryItem>>(`/api/history${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useHistoryItem(id: string) {
  return useQuery({ queryKey: qk.historyItem(id), queryFn: () => api<HistoryDetail>(`/api/history/${id}`) });
}

export function usePublicProfile(id: string) {
  return useQuery({ queryKey: qk.profile(id), queryFn: () => api<PublicProfile>(`/api/profiles/${id}`), retry: false });
}

export function useBlocks() {
  const enabled = useSignedIn();
  return useQuery({
    queryKey: qk.blocks,
    enabled,
    queryFn: () => api<{ items: Array<{ userId: string; displayName: string; avatarSeed: string; avatarStyle: string; blockedAt: string }> }>('/api/blocks').then((r) => r.items),
  });
}

/** Shared invalidation after social mutations. */
export function useInvalidateSocial() {
  const qc = useQueryClient();
  return () => {
    for (const k of [qk.friends, qk.requests, qk.inbox, qk.unread, qk.friendPresence, qk.history, qk.notifications, qk.blocks, qk.me]) qc.invalidateQueries({ queryKey: k });
  };
}
