export const LIMITS = {
  maxDocBytes: 1024 * 1024,
  maxMessageBytes: 256 * 1024,
  maxConnections: 25,
  ratePerSecond: 60,
  burst: 120,
} as const;

export class TokenBucket {
  #tokens: number;
  #last: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number = Date.now(),
  ) {
    this.#tokens = burst;
    this.#last = now;
  }

  take(now: number = Date.now()): boolean {
    this.#tokens = Math.min(this.burst, this.#tokens + ((now - this.#last) / 1000) * this.rate);
    this.#last = now;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

const utf8 = new TextEncoder();

export function messageBytes(m: string | ArrayBuffer | ArrayBufferView): number {
  return typeof m === 'string' ? utf8.encode(m).byteLength : m.byteLength;
}
