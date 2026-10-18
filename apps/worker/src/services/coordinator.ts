import type { Env } from '../env';

export function coordinator(env: Env) {
  return env.MATCH_COORDINATOR.get(env.MATCH_COORDINATOR.idFromName('global'));
}

export function room(env: Env, roomId: string) {
  return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(roomId));
}
