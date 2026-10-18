import type { AvatarStyle } from '@orbit/shared';

/** Deterministic, safe generated avatars (no uploads). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PALETTES: Record<AvatarStyle, [string, string, string]> = {
  orbit: ['#14E0C4', '#3D7BFF', '#0B1020'],
  nebula: ['#8B5CF6', '#EC4899', '#1E1036'],
  comet: ['#FF7A6B', '#FFC15E', '#2A1410'],
  aurora: ['#34D399', '#22D3EE', '#06231F'],
  pulse: ['#3D7BFF', '#FF7A6B', '#0E1530'],
  prism: ['#F59E0B', '#14E0C4', '#1F1A08'],
};

export function avatarParams(seed: string, style: AvatarStyle) {
  const h = hash(seed + style);
  const [c1, c2, dark] = PALETTES[style] ?? PALETTES.orbit;
  return {
    c1,
    c2,
    dark,
    angle: h % 360,
    ringTilt: (h >> 8) % 70 - 35,
    moonAngle: ((h >> 4) % 360) * (Math.PI / 180),
    planetR: 16 + ((h >> 12) % 8),
  };
}

export function randomSeed(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('') + Math.floor(Math.random() * 1e4).toString(36);
}
