import type { IdRef } from './lexer';
import { cellKey, type SheetSnapshot, splitCellKey } from './model';
import { type Ast, type BinOp, type CellError, parseFormula } from './parser';

export type CellValue =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: CellError }
  | { t: 'empty' };

type Num = { t: 'num'; v: number };
type Err = { t: 'err'; v: CellError };

/** Longest text a formula may produce (Excel's cell text limit); longer results are #VALUE!. */
export const MAX_TEXT_RESULT = 32767;

const EMPTY: CellValue = { t: 'empty' };
const err = (v: CellError): Err => ({ t: 'err', v });
const num = (v: number): Num | Err => (Number.isFinite(v) ? { t: 'num', v } : err('#NUM!'));

const NUMBER_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** The value of a non-formula source: a number literal, TRUE/FALSE, or text. */
export function literalValue(src: string): CellValue {
  if (src === '') return EMPTY;
  const s = src.trim();
  if (NUMBER_LITERAL.test(s)) return num(Number(s));
  const up = s.toUpperCase();
  if (up === 'TRUE' || up === 'FALSE') return { t: 'bool', v: up === 'TRUE' };
  return { t: 'str', v: src };
}

const toNum = (v: CellValue): Num | Err => {
  switch (v.t) {
    case 'num':
    case 'err':
      return v;
    case 'empty':
      return { t: 'num', v: 0 };
    case 'bool':
      return { t: 'num', v: v.v ? 1 : 0 };
    case 'str':
      return err('#VALUE!');
  }
};

const numberText = (n: number): string => String(Number(n.toPrecision(15)));

const toText = (v: CellValue): string => {
  switch (v.t) {
    case 'num':
      return numberText(v.v);
    case 'str':
      return v.v;
    case 'bool':
      return v.v ? 'TRUE' : 'FALSE';
    default:
      return '';
  }
};

type Plain = Exclude<CellValue, { t: 'err' }>;
const blankLike = (v: Plain): Plain =>
  v.t === 'num'
    ? { t: 'num', v: 0 }
    : v.t === 'str'
      ? { t: 'str', v: '' }
      : v.t === 'bool'
        ? { t: 'bool', v: false }
        : v;
const rank = (v: Plain): number => (v.t === 'num' ? 0 : v.t === 'str' ? 1 : 2);

/** Ordering for comparisons: numbers < text < booleans; text is case-insensitive; empty takes the other side's type. */
function compare(a0: Plain, b0: Plain): number {
  if (a0.t === 'empty' && b0.t === 'empty') return 0;
  const a = a0.t === 'empty' ? blankLike(b0) : a0;
  const b = b0.t === 'empty' ? blankLike(a0) : b0;
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1;
  if (a.t === 'num' && b.t === 'num') return Math.sign(a.v - b.v);
  if (a.t === 'str' && b.t === 'str') {
    const x = a.v.toLowerCase();
    const y = b.v.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (a.t === 'bool' && b.t === 'bool') return Number(a.v) - Number(b.v);
  return 0;
}

const COMPARISONS: Partial<Record<BinOp, (c: number) => boolean>> = {
  '=': (c) => c === 0,
  '<>': (c) => c !== 0,
  '<': (c) => c < 0,
  '>': (c) => c > 0,
  '<=': (c) => c <= 0,
  '>=': (c) => c >= 0,
};

function binary(op: BinOp, a: CellValue, b: CellValue): CellValue {
  if (a.t === 'err') return a;
  if (b.t === 'err') return b;
  if (op === '&') {
    const x = toText(a);
    const y = toText(b);
    // Checked before allocating: doubling chains would otherwise reach hundreds of MB.
    return x.length + y.length > MAX_TEXT_RESULT ? err('#VALUE!') : { t: 'str', v: x + y };
  }
  const cmp = COMPARISONS[op];
  if (cmp) return { t: 'bool', v: cmp(compare(a, b)) };
  const x = toNum(a);
  if (x.t === 'err') return x;
  const y = toNum(b);
  if (y.t === 'err') return y;
  switch (op) {
    case '+':
      return num(x.v + y.v);
    case '-':
      return num(x.v - y.v);
    case '*':
      return num(x.v * y.v);
    case '/':
      return y.v === 0 ? err('#DIV/0!') : num(x.v / y.v);
    default:
      return num(x.v ** y.v);
  }
}

/** Rounds half away from zero to `digits` (negative digits round left of the point). */
function round(x: number, digits: number): number {
  const shifted = Number(`${Math.abs(x)}e${digits}`);
  const r = Number.isFinite(shifted)
    ? Number(`${Math.round(shifted)}e${-digits}`)
    : Math.round(Math.abs(x) * 10 ** digits) / 10 ** digits;
  return Math.sign(x) * r;
}

const AGGREGATES = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT']);

/** Deepest formula-to-formula reference chain evaluated; a cell past it is #NUM! (keeps the JS stack safe). */
export const MAX_EVAL_DEPTH = 1000;

/** Evaluates every formula of a sheet; the map holds a value for each non-empty cell. */
export function evaluateSheet(sheet: SheetSnapshot): Map<string, CellValue> {
  const rowIndex = new Map(sheet.rows.map((r, i) => [r.id, i]));
  const colIndex = new Map(sheet.cols.map((c, i) => [c.id, i]));
  const values = new Map<string, CellValue>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclic = new Set<string>();
  const asts = new Map<string, Ast | null>();

  const refKey = (ref: IdRef): string | null =>
    rowIndex.has(ref.row) && colIndex.has(ref.col) ? cellKey(ref.row, ref.col) : null;

  const cellValue = (key: string): CellValue => {
    const known = values.get(key);
    if (known) return known;
    if (onStack.has(key)) {
      for (let i = stack.lastIndexOf(key); i < stack.length; i++) cyclic.add(stack[i] as string);
      return err('#CYCLE!');
    }
    const cell = sheet.cells[key];
    let v: CellValue;
    if (!cell || cell.src === '') v = EMPTY;
    else if (!cell.src.startsWith('=')) v = literalValue(cell.src);
    else if (stack.length >= MAX_EVAL_DEPTH) v = err('#NUM!');
    else {
      let ast = asts.get(key);
      if (ast === undefined) {
        ast = parseFormula(cell.src.slice(1));
        asts.set(key, ast);
      }
      stack.push(key);
      onStack.add(key);
      v = ast ? scalar(ast) : err('#ERROR!');
      stack.pop();
      onStack.delete(key);
      if (v.t === 'empty') v = { t: 'num', v: 0 };
      if (cyclic.has(key)) v = err('#CYCLE!');
    }
    values.set(key, v);
    return v;
  };

  /** The values of a rectangular range in the current order; #REF! if a corner is gone. */
  const rangeValues = (from: IdRef, to: IdRef): CellValue[] | Err => {
    const r0 = rowIndex.get(from.row);
    const r1 = rowIndex.get(to.row);
    const c0 = colIndex.get(from.col);
    const c1 = colIndex.get(to.col);
    if (r0 === undefined || r1 === undefined || c0 === undefined || c1 === undefined)
      return err('#REF!');
    const out: CellValue[] = [];
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
        out.push(
          cellValue(
            cellKey((sheet.rows[r] as { id: string }).id, (sheet.cols[c] as { id: string }).id),
          ),
        );
      }
    }
    return out;
  };

  const aggregate = (name: string, args: Ast[]): CellValue => {
    if (args.length === 0) return err('#VALUE!');
    const nums: number[] = [];
    for (const a of args) {
      if (a.k === 'range' || a.k === 'ref') {
        let vals: CellValue[] | Err;
        if (a.k === 'range') vals = rangeValues(a.from, a.to);
        else {
          const key = refKey(a.ref);
          vals = key ? [cellValue(key)] : err('#REF!');
        }
        if (!Array.isArray(vals)) return vals;
        for (const v of vals) {
          if (v.t === 'err') return v;
          if (v.t === 'num') nums.push(v.v);
        }
        continue;
      }
      const v = scalar(a);
      if (v.t === 'err') return v;
      if (name === 'COUNT') {
        if (v.t === 'num') nums.push(v.v);
        continue;
      }
      const x = toNum(v);
      if (x.t === 'err') return x;
      nums.push(x.v);
    }
    const sum = nums.reduce((s, x) => s + x, 0);
    switch (name) {
      case 'SUM':
        return num(sum);
      case 'AVERAGE':
        return nums.length > 0 ? num(sum / nums.length) : err('#DIV/0!');
      case 'MIN':
        return num(nums.length > 0 ? nums.reduce((m, x) => Math.min(m, x)) : 0);
      case 'MAX':
        return num(nums.length > 0 ? nums.reduce((m, x) => Math.max(m, x)) : 0);
      default:
        return num(nums.length);
    }
  };

  const call = (name: string, args: Ast[]): CellValue => {
    if (AGGREGATES.has(name)) return aggregate(name, args);
    switch (name) {
      case 'ABS': {
        if (args.length !== 1) return err('#VALUE!');
        const x = toNum(scalar(args[0] as Ast));
        return x.t === 'num' ? num(Math.abs(x.v)) : x;
      }
      case 'ROUND': {
        if (args.length !== 2) return err('#VALUE!');
        const x = toNum(scalar(args[0] as Ast));
        if (x.t === 'err') return x;
        const d = toNum(scalar(args[1] as Ast));
        if (d.t === 'err') return d;
        return num(round(x.v, Math.trunc(d.v)));
      }
      case 'IF': {
        if (args.length < 2 || args.length > 3) return err('#VALUE!');
        const c = scalar(args[0] as Ast);
        if (c.t === 'err') return c;
        if (c.t === 'str') return err('#VALUE!');
        const truthy = c.t === 'bool' ? c.v : c.t === 'num' ? c.v !== 0 : false;
        if (truthy) return scalar(args[1] as Ast);
        return args[2] ? scalar(args[2]) : { t: 'bool', v: false };
      }
      default:
        return err('#NAME?');
    }
  };

  function scalar(node: Ast): CellValue {
    switch (node.k) {
      case 'num':
        return num(node.v);
      case 'str':
        return { t: 'str', v: node.v };
      case 'bool':
        return { t: 'bool', v: node.v };
      case 'err':
        return err(node.v);
      case 'ref': {
        const key = refKey(node.ref);
        return key ? cellValue(key) : err('#REF!');
      }
      case 'range':
        return err('#VALUE!');
      case 'neg': {
        const x = toNum(scalar(node.arg));
        return x.t === 'num' ? num(-x.v) : x;
      }
      case 'pct': {
        const x = toNum(scalar(node.arg));
        return x.t === 'num' ? num(x.v / 100) : x;
      }
      case 'bin':
        return binary(node.op, scalar(node.l), scalar(node.r));
      case 'call':
        return call(node.name, node.args);
    }
  }

  // Row-major in the snapshot's order, not Object.keys order: map iteration differs between
  // replicas, and upward/leftward references get memoized first, which keeps the stack shallow.
  // Keys outside the grid go last, by key, so the order is fully deterministic.
  const position = (key: string): [number, number] => {
    const [row, col] = splitCellKey(key) ?? ['', ''];
    return [
      rowIndex.get(row) ?? Number.MAX_SAFE_INTEGER,
      colIndex.get(col) ?? Number.MAX_SAFE_INTEGER,
    ];
  };
  const order = Object.keys(sheet.cells)
    .map((key) => ({ key, pos: position(key) }))
    .sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || (a.key < b.key ? -1 : 1))
    .map((o) => o.key);
  for (const key of order) {
    // Last resort: a stack overflow from deeply nested formulas must never crash the sheet.
    // Every cell left mid-evaluation is memoized #NUM! too, so later cells do not re-descend the chain.
    try {
      cellValue(key);
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      for (const k of stack) values.set(k, err('#NUM!'));
      stack.length = 0;
      onStack.clear();
      values.set(key, err('#NUM!'));
    }
  }
  return values;
}
