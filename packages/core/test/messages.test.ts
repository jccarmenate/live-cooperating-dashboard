import { describe, expect, it } from 'vitest';
import { isTimeRequest, parseServerMessage, TIME_REQUEST } from '../src';

describe('server messages', () => {
  it('parses hello and time', () => {
    expect(parseServerMessage('{"type":"hello","role":"view","now":5}')).toEqual({
      type: 'hello',
      role: 'view',
      now: 5,
    });
    expect(parseServerMessage('{"type":"time","now":7}')).toEqual({ type: 'time', now: 7 });
  });

  it('keeps a bounded viewKey on hello', () => {
    expect(parseServerMessage('{"type":"hello","role":"edit","now":1,"viewKey":"abc"}')).toEqual({
      type: 'hello',
      role: 'edit',
      now: 1,
      viewKey: 'abc',
    });
    expect(
      parseServerMessage(`{"type":"hello","role":"edit","now":1,"viewKey":"${'k'.repeat(65)}"}`),
    ).toEqual({
      type: 'hello',
      role: 'edit',
      now: 1,
    });
  });

  it('ignores malformed or unknown messages', () => {
    for (const raw of [
      'nope',
      '{"type":"hello","role":"admin","now":5}',
      '{"type":"time","now":"7"}',
      '{"type":"time"}',
      '{"type":"other","now":1}',
      'null',
    ]) {
      expect(parseServerMessage(raw)).toBeNull();
    }
  });

  it('recognises the time request', () => {
    expect(isTimeRequest(TIME_REQUEST)).toBe(true);
    expect(isTimeRequest('{"type":"time"}')).toBe(false);
    expect(isTimeRequest('garbage')).toBe(false);
  });
});
