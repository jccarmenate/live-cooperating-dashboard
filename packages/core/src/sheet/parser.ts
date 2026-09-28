import { type IdRef, lex, type Token } from './lexer';

export type CellError =
  | '#REF!'
  | '#DIV/0!'
  | '#CYCLE!'
  | '#NAME?'
  | '#VALUE!'
  | '#NUM!'
  | '#ERROR!';
export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; v: CellError }
  | { k: 'ref'; ref: IdRef }
  | { k: 'range'; from: IdRef; to: IdRef }
  | { k: 'neg'; arg: Ast }
  | { k: 'pct'; arg: Ast }
  | { k: 'bin'; op: BinOp; l: Ast; r: Ast }
  | { k: 'call'; name: string; args: Ast[] };

/** Infix binding powers (spec precedence: comparisons < & < +- < *\/ < ^ < unary < %). */
const INFIX: Partial<Record<string, number>> = {
  '=': 10,
  '<>': 10,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  '&': 20,
  '+': 30,
  '-': 30,
  '*': 40,
  '/': 40,
  '^': 50,
};
const PREFIX_BP = 60;
const PCT_BP = 70;

class SyntaxFail extends Error {}
const fail = (): never => {
  throw new SyntaxFail();
};
const REF_ERR: Ast = { k: 'err', v: '#REF!' };

/** Parses a stored formula body (without "="). Returns null on a syntax error. */
export function parseFormula(body: string): Ast | null {
  const tokens = lex(body);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token => tokens[pos++] ?? fail();

  /** After `from:`, the range's other corner; a missing corner is #REF!, anything else a syntax error. */
  const rangeEnd = (): IdRef | null => {
    const t = next();
    if (t.k === 'id') return t.ref;
    if (t.k === 'refErr' || t.k === 'a1') return null;
    return fail();
  };

  const prefix = (): Ast => {
    const t = next();
    switch (t.k) {
      case 'num':
        return { k: 'num', v: t.v };
      case 'str':
        return { k: 'str', v: t.v };
      case 'bool':
        return { k: 'bool', v: t.v };
      case 'refErr':
      case 'a1':
        // Stored formulas hold no A1 references: a leftover is a broken reference.
        if (peek()?.k === ':') {
          next();
          rangeEnd();
        }
        return REF_ERR;
      case 'id': {
        if (peek()?.k !== ':') return { k: 'ref', ref: t.ref };
        next();
        const to = rangeEnd();
        return to ? { k: 'range', from: t.ref, to } : REF_ERR;
      }
      case 'name': {
        if (peek()?.k !== '(') return { k: 'err', v: '#NAME?' };
        next();
        const args: Ast[] = [];
        if (peek()?.k === ')') {
          next();
          return { k: 'call', name: t.v, args };
        }
        for (;;) {
          args.push(expr(0));
          const sep = next();
          if (sep.k === ')') break;
          if (sep.k !== ',') fail();
        }
        return { k: 'call', name: t.v, args };
      }
      case '(': {
        const inner = expr(0);
        if (next().k !== ')') fail();
        return inner;
      }
      case 'op':
        if (t.v === '-') return { k: 'neg', arg: expr(PREFIX_BP) };
        if (t.v === '+') return expr(PREFIX_BP);
        return fail();
      default:
        return fail();
    }
  };

  const expr = (minBp: number): Ast => {
    let left = prefix();
    for (;;) {
      const t = peek();
      if (t?.k !== 'op') break;
      if (t.v === '%') {
        if (PCT_BP <= minBp) break;
        next();
        left = { k: 'pct', arg: left };
        continue;
      }
      const bp = INFIX[t.v];
      if (bp === undefined || bp <= minBp) break;
      next();
      const right = expr(t.v === '^' ? bp - 1 : bp);
      left = { k: 'bin', op: t.v as BinOp, l: left, r: right };
    }
    return left;
  };

  try {
    const ast = expr(0);
    return pos === tokens.length ? ast : null;
  } catch (e) {
    if (e instanceof SyntaxFail) return null;
    throw e;
  }
}
