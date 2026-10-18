/**
 * Pure, deterministic matchmaking engine (no I/O). The MatchCoordinator Durable Object
 * wraps it, persists dirty entries and performs network side effects.
 *
 * Algorithm: first-available FIFO matching.
 *   join(A): scan the waiting queue oldest-first and pair A with the first ELIGIBLE user.
 *   Eligibility ONLY considers: not self, connected/fresh, still QUEUED, not blocked
 *   in either direction, not already in a session. Demographic or profile attributes
 *   are intentionally NOT part of MatchProfile, so they cannot influence pairing.
 *
 * Atomicity: a Durable Object processes each event to completion on a single thread
 * before any await, and join() is fully synchronous, so two concurrent joins can never
 * claim the same waiting user.
 */

export type UserState = 'IDLE' | 'QUEUED' | 'MATCHING' | 'MATCHED' | 'DISCONNECTED';

/** Only display data needed to introduce strangers. Deliberately excludes demographics. */
export interface MatchProfile {
  displayName: string;
  avatarSeed: string;
  avatarStyle: string;
}

export interface UserEntry {
  userId: string;
  state: UserState;
  /** Number of live lobby sockets. */
  connections: number;
  lastSeen: number;
  queuedAt: number | null;
  /** Monotonic tiebreaker so FIFO order is stable even when timestamps collide. */
  queueSeq: number | null;
  roomId: string | null;
  peerId: string | null;
  matchedAt: number | null;
  /** Users this person blocked or was blocked by (symmetric for matching purposes). */
  blocked: string[];
  profile: MatchProfile;
}

export interface EngineOptions {
  now: () => number;
  newRoomId: () => string;
  staleMs: number;
  /** A MATCHED entry whose room never confirmed is released after this long. */
  orphanMatchMs: number;
}

export type JoinResult =
  | { type: 'matched'; roomId: string; userA: UserEntry; userB: UserEntry; waitedMs: number }
  | { type: 'queued'; position: number; duplicate: boolean }
  | { type: 'error'; code: 'already_in_session' | 'unknown_user'; roomId?: string };

export interface EngineStats {
  online: number;
  waiting: number;
  inChat: number;
}

export class MatchEngine {
  readonly users = new Map<string, UserEntry>();
  /** Waiting queue, oldest first. Contains userIds whose state is QUEUED. */
  private queue: string[] = [];
  private seq = 0;
  /** Ids whose entries changed since the last flush (for persistence). */
  readonly dirty = new Set<string>();

  constructor(private readonly opts: EngineOptions) {}

  // ------------------------------------------------------------------ restore / persist
  /** Rebuild from persisted entries (e.g. after Durable Object eviction). */
  restore(entries: UserEntry[], seq = 0): void {
    this.users.clear();
    for (const e of entries) {
      // MATCHING is a transient in-call state; it can never survive a restart.
      if (e.state === 'MATCHING') e.state = 'IDLE';
      this.users.set(e.userId, { ...e, blocked: [...e.blocked] });
    }
    this.queue = entries
      .filter((e) => e.state === 'QUEUED')
      .sort((a, b) => (a.queuedAt! - b.queuedAt!) || (a.queueSeq! - b.queueSeq!))
      .map((e) => e.userId);
    this.seq = Math.max(seq, ...entries.map((e) => e.queueSeq ?? 0), 0);
    this.dirty.clear();
  }

  get queueSeqCounter(): number {
    return this.seq;
  }

  takeDirty(): string[] {
    const ids = [...this.dirty];
    this.dirty.clear();
    return ids;
  }

  private touchDirty(id: string): void {
    this.dirty.add(id);
  }

  // ------------------------------------------------------------------ connections
  /**
   * Register a lobby connection. Returns the entry. Refreshes profile and block list
   * (these come from the authenticated ticket, never from the client).
   */
  connect(userId: string, profile: MatchProfile, blocked: string[]): UserEntry {
    const now = this.opts.now();
    let e = this.users.get(userId);
    if (!e) {
      e = {
        userId,
        state: 'IDLE',
        connections: 0,
        lastSeen: now,
        queuedAt: null,
        queueSeq: null,
        roomId: null,
        peerId: null,
        matchedAt: null,
        blocked: [],
        profile,
      };
      this.users.set(userId, e);
    }
    e.connections += 1;
    e.lastSeen = now;
    e.profile = profile;
    e.blocked = [...new Set([...e.blocked, ...blocked])];
    if (e.state === 'DISCONNECTED') e.state = e.roomId ? 'MATCHED' : 'IDLE';
    this.touchDirty(userId);
    return e;
  }

  /** A lobby socket closed. Queued users with no remaining sockets leave the queue. */
  disconnect(userId: string): void {
    const e = this.users.get(userId);
    if (!e) return;
    e.connections = Math.max(0, e.connections - 1);
    if (e.connections === 0) {
      if (e.state === 'QUEUED') this.removeFromQueue(e);
      // A matched user keeps the room; the room itself enforces the reconnect grace period.
      if (e.state !== 'MATCHED') e.state = 'DISCONNECTED';
    }
    this.touchDirty(userId);
  }

  heartbeat(userId: string): void {
    const e = this.users.get(userId);
    if (!e) return;
    e.lastSeen = this.opts.now();
    // Not marked dirty: lastSeen is reconstructed from live sockets after restarts.
  }

  /** Re-sync connection counters with the actually open sockets (after restore). */
  syncConnections(liveCounts: Map<string, number>): void {
    const now = this.opts.now();
    for (const e of this.users.values()) {
      const n = liveCounts.get(e.userId) ?? 0;
      if (n !== e.connections) {
        e.connections = n;
        if (n > 0) e.lastSeen = now;
        if (n === 0 && e.state === 'QUEUED') this.removeFromQueue(e);
        if (n === 0 && e.state !== 'MATCHED') e.state = 'DISCONNECTED';
        this.touchDirty(e.userId);
      }
    }
  }

  // ------------------------------------------------------------------ eligibility
  private isFresh(e: UserEntry, now: number): boolean {
    return e.connections > 0 && now - e.lastSeen <= this.opts.staleMs;
  }

  private isBlockedPair(a: UserEntry, b: UserEntry): boolean {
    return a.blocked.includes(b.userId) || b.blocked.includes(a.userId);
  }

  /** Can `candidate` (a waiting user) be paired with `seeker`? */
  canPair(seeker: UserEntry, candidate: UserEntry): boolean {
    if (seeker.userId === candidate.userId) return false;
    if (candidate.state !== 'QUEUED') return false;
    if (!this.isFresh(candidate, this.opts.now())) return false;
    if (candidate.roomId || seeker.roomId) return false;
    if (this.isBlockedPair(seeker, candidate)) return false;
    return true;
  }

  // ------------------------------------------------------------------ queue ops
  join(userId: string): JoinResult {
    const now = this.opts.now();
    const me = this.users.get(userId);
    if (!me) return { type: 'error', code: 'unknown_user' };
    if (me.state === 'MATCHED' && me.roomId) return { type: 'error', code: 'already_in_session', roomId: me.roomId };
    if (me.state === 'QUEUED') return { type: 'queued', position: this.positionOf(userId), duplicate: true };

    me.state = 'MATCHING';
    me.lastSeen = now;
    this.touchDirty(userId);

    // Scan oldest-first. Stale/disconnected entries are pruned as we go.
    for (let i = 0; i < this.queue.length; ) {
      const candidateId = this.queue[i];
      const cand = this.users.get(candidateId);
      if (!cand || cand.state !== 'QUEUED') {
        this.queue.splice(i, 1);
        continue;
      }
      if (!this.isFresh(cand, now)) {
        // Disconnected/stale waiting user: remove and move on to the next one.
        this.queue.splice(i, 1);
        cand.state = cand.connections > 0 ? 'IDLE' : 'DISCONNECTED';
        cand.queuedAt = null;
        cand.queueSeq = null;
        this.touchDirty(cand.userId);
        continue;
      }
      if (this.canPair(me, cand)) {
        this.queue.splice(i, 1);
        const roomId = this.opts.newRoomId();
        const waitedMs = cand.queuedAt ? now - cand.queuedAt : 0;
        for (const [x, y] of [
          [cand, me],
          [me, cand],
        ] as const) {
          x.state = 'MATCHED';
          x.roomId = roomId;
          x.peerId = y.userId;
          x.matchedAt = now;
          x.queuedAt = null;
          x.queueSeq = null;
          this.touchDirty(x.userId);
        }
        // userA = the user who waited longest (the "oldest eligible waiting user").
        return { type: 'matched', roomId, userA: cand, userB: me, waitedMs };
      }
      i++;
    }

    me.state = 'QUEUED';
    me.queuedAt = now;
    me.queueSeq = ++this.seq;
    this.queue.push(userId);
    return { type: 'queued', position: this.queue.length, duplicate: false };
  }

  leave(userId: string): boolean {
    const e = this.users.get(userId);
    if (!e || e.state !== 'QUEUED') return false;
    this.removeFromQueue(e);
    e.state = 'IDLE';
    this.touchDirty(userId);
    return true;
  }

  private removeFromQueue(e: UserEntry): void {
    const idx = this.queue.indexOf(e.userId);
    if (idx >= 0) this.queue.splice(idx, 1);
    e.queuedAt = null;
    e.queueSeq = null;
    if (e.state === 'QUEUED') e.state = 'IDLE';
  }

  /**
   * End a room: both participants return to IDLE. Idempotent.
   * Returns the user ids that were released.
   */
  endRoom(roomId: string): string[] {
    const released: string[] = [];
    for (const e of this.users.values()) {
      if (e.roomId === roomId) {
        e.roomId = null;
        e.peerId = null;
        e.matchedAt = null;
        e.state = e.connections > 0 ? 'IDLE' : 'DISCONNECTED';
        this.touchDirty(e.userId);
        released.push(e.userId);
      }
    }
    return released;
  }

  /** Next Stranger: release the current room (if any) and immediately re-enter matchmaking. */
  next(userId: string): { endedRoomId: string | null; released: string[]; result: JoinResult } {
    const e = this.users.get(userId);
    if (!e) return { endedRoomId: null, released: [], result: { type: 'error', code: 'unknown_user' } };
    const roomId = e.roomId;
    const released = roomId ? this.endRoom(roomId) : [];
    return { endedRoomId: roomId, released, result: this.join(userId) };
  }

  /** Record a block in both entries; ends a shared room. Returns the room id if one was ended. */
  block(a: string, b: string): string | null {
    const ea = this.users.get(a);
    const eb = this.users.get(b);
    if (ea && !ea.blocked.includes(b)) ea.blocked.push(b);
    if (eb && !eb.blocked.includes(a)) eb.blocked.push(a);
    if (ea) this.touchDirty(a);
    if (eb) this.touchDirty(b);
    if (ea?.roomId && ea.peerId === b) {
      const r = ea.roomId;
      this.endRoom(r);
      return r;
    }
    return null;
  }

  /** Remove a user entirely (account deleted / banned). Returns room id if they were matched. */
  evict(userId: string): string | null {
    const e = this.users.get(userId);
    if (!e) return null;
    const roomId = e.roomId;
    if (roomId) this.endRoom(roomId);
    this.removeFromQueue(e);
    this.users.delete(userId);
    this.touchDirty(userId);
    return roomId;
  }

  /**
   * Periodic cleanup: drop stale queue entries and forget long-idle disconnected users.
   * Returns rooms that were force-released because they never confirmed creation.
   */
  sweep(idleForgetMs: number): { removedFromQueue: string[]; forgotten: string[] } {
    const now = this.opts.now();
    const removedFromQueue: string[] = [];
    const forgotten: string[] = [];
    for (const id of [...this.queue]) {
      const e = this.users.get(id);
      if (!e || !this.isFresh(e, now)) {
        this.queue.splice(this.queue.indexOf(id), 1);
        if (e) {
          e.state = e.connections > 0 ? 'IDLE' : 'DISCONNECTED';
          e.queuedAt = null;
          e.queueSeq = null;
          this.touchDirty(id);
        }
        removedFromQueue.push(id);
      }
    }
    for (const e of [...this.users.values()]) {
      if (e.state === 'MATCHED' && e.matchedAt && e.connections === 0 && now - e.matchedAt > this.opts.orphanMatchMs) {
        // Room should have reported its end long ago (grace is far shorter). Release defensively.
        if (e.roomId) this.endRoom(e.roomId);
      }
      if (e.connections === 0 && e.state !== 'MATCHED' && now - e.lastSeen > idleForgetMs) {
        this.users.delete(e.userId);
        this.touchDirty(e.userId);
        forgotten.push(e.userId);
      }
    }
    return { removedFromQueue, forgotten };
  }

  // ------------------------------------------------------------------ queries
  positionOf(userId: string): number {
    const i = this.queue.indexOf(userId);
    return i < 0 ? 0 : i + 1;
  }

  queueSnapshot(): string[] {
    return [...this.queue];
  }

  get(userId: string): UserEntry | undefined {
    return this.users.get(userId);
  }

  stats(): EngineStats {
    const now = this.opts.now();
    let online = 0;
    let inChat = 0;
    for (const e of this.users.values()) {
      if (this.isFresh(e, now)) online++;
      if (e.state === 'MATCHED') inChat++;
    }
    return { online, waiting: this.queue.length, inChat };
  }

  presenceOf(userId: string): 'online' | 'in_chat' | 'searching' | 'offline' {
    const e = this.users.get(userId);
    if (!e) return 'offline';
    if (e.state === 'MATCHED') return 'in_chat';
    if (!this.isFresh(e, this.opts.now())) return 'offline';
    if (e.state === 'QUEUED') return 'searching';
    return 'online';
  }
}
