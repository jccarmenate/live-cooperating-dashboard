export interface Env {
  Room: DurableObjectNamespace;
  ROOM_SECRET: string;
  /** Comma-separated list of origins allowed to call the HTTP API. */
  ALLOWED_ORIGINS: string;
}
