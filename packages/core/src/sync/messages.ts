/** A connection's capability, as the server reports it in `hello`. */
export type Role = 'edit' | 'view';

/** Custom messages the room sends over y-partyserver's `__YPS:` channel. */
export type ServerMessage =
  | { type: 'hello'; role: Role; now: number }
  | { type: 'time'; now: number };

/** What the client sends to refresh its clock offset. */
export const TIME_REQUEST = JSON.stringify({ type: 'time?' });

const parse = (raw: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export function parseServerMessage(raw: string): ServerMessage | null {
  const o = parse(raw);
  if (!o || typeof o.now !== 'number' || !Number.isFinite(o.now)) return null;
  if (o.type === 'time') return { type: 'time', now: o.now };
  if (o.type === 'hello' && (o.role === 'edit' || o.role === 'view')) {
    return { type: 'hello', role: o.role, now: o.now };
  }
  return null;
}

export const isTimeRequest = (raw: string): boolean => parse(raw)?.type === 'time?';
