import { colIndex } from './address';

export interface A1Ref {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

export interface IdRef {
  row: string;
  col: string;
  absRow: boolean;
  absCol: boolean;
}

export type OpToken =
  | '+'
  | '-'
  | '*'
  | '/'
  | '^'
  | '%'
  | '&'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>=';

export type Token = { s: number; e: number } & (
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'a1'; ref: A1Ref }
  | { k: 'id'; ref: IdRef }
  | { k: 'refErr' }
  | { k: 'name'; v: string }
  | { k: 'op'; v: OpToken }
  | { k: '(' }
  | { k: ')' }
  | { k: ',' }
  | { k: ':' }
);

const NUM = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const A1 = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(.])/;
const ID_REF = /^\[(\$?)([a-z0-9]{1,16})\.(\$?)([a-z0-9]{1,16})\]/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.]*/;
const OPS: readonly OpToken[] = [
  '<=',
  '>=',
  '<>',
  '+',
  '-',
  '*',
  '/',
  '^',
  '%',
  '&',
  '=',
  '<',
  '>',
];
const PUNCT = new Set(['(', ')', ',', ':']);

/** Tokens of a formula body (without the leading "="); null on an invalid character or unterminated string. */
export function lex(body: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = body.slice(i);
    const num = NUM.exec(rest);
    if (num) {
      out.push({ k: 'num', v: Number(num[0]), s: i, e: i + num[0].length });
      i += num[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= body.length) return null;
        if (body[j] === '"') {
          if (body[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += body[j];
        j++;
      }
      out.push({ k: 'str', v, s: i, e: j + 1 });
      i = j + 1;
      continue;
    }
    if (rest.startsWith('#REF!')) {
      out.push({ k: 'refErr', s: i, e: i + 5 });
      i += 5;
      continue;
    }
    const idRef = ID_REF.exec(rest);
    if (idRef) {
      out.push({
        k: 'id',
        ref: {
          absRow: idRef[1] === '$',
          row: idRef[2] as string,
          absCol: idRef[3] === '$',
          col: idRef[4] as string,
        },
        s: i,
        e: i + idRef[0].length,
      });
      i += idRef[0].length;
      continue;
    }
    const a1 = A1.exec(rest);
    if (a1) {
      out.push({
        k: 'a1',
        ref: {
          absCol: a1[1] === '$',
          col: colIndex(a1[2] as string),
          absRow: a1[3] === '$',
          row: Number(a1[4]) - 1,
        },
        s: i,
        e: i + a1[0].length,
      });
      i += a1[0].length;
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      const up = name[0].toUpperCase();
      const e = i + name[0].length;
      out.push(
        up === 'TRUE' || up === 'FALSE'
          ? { k: 'bool', v: up === 'TRUE', s: i, e }
          : { k: 'name', v: up, s: i, e },
      );
      i = e;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      out.push({ k: 'op', v: op, s: i, e: i + op.length });
      i += op.length;
      continue;
    }
    if (PUNCT.has(ch)) {
      out.push({ k: ch as '(' | ')' | ',' | ':', s: i, e: i + 1 });
      i++;
      continue;
    }
    return null;
  }
  return out;
}
