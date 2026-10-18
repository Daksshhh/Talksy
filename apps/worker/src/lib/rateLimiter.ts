/** Sliding-window rate limiter (pure, in-memory). */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit if allowed. Returns 0 when allowed, otherwise ms until next allowed hit. */
  take(key: string): number {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return Math.max(1, this.windowMs - (t - arr[0]));
    }
    arr.push(t);
    this.hits.set(key, arr);
    if (this.hits.size > 10_000) this.prune();
    return 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(): void {
    const t = this.now();
    for (const [k, arr] of this.hits) if (!arr.length || t - arr[arr.length - 1] >= this.windowMs) this.hits.delete(k);
  }
}
