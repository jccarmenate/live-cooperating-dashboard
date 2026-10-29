export interface Env {
  Room: DurableObjectNamespace;
  ROOM_SECRET: string;
  /** Comma-separated list of origins allowed to call the HTTP API. */
  ALLOWED_ORIGINS: string;
  /** Workers rate limiting binding: 10 room creations per 60 s per address. */
  ROOM_CREATE_LIMITER: RateLimit;
  /** `'off'` skips the room-creation limit. Set only by local dev and the test servers. */
  ROOM_CREATE_LIMIT?: string;
}
