/** The open dialogs, oldest first: only the topmost one answers a window-level Escape. */
const stack: symbol[] = [];

export interface DialogEntry {
  isTop(): boolean;
  remove(): void;
}

/** Registers a newly opened dialog on top of the others. */
export function pushDialog(): DialogEntry {
  const id = Symbol('dialog');
  stack.push(id);
  return {
    isTop: () => stack.at(-1) === id,
    remove() {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    },
  };
}
