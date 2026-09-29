/**
 * Focus is in an editable element or a select: board keys and clipboard shortcuts must leave
 * it alone (a select's arrows and letters pick an option; they must not nudge or switch tools).
 */
export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  );
}

/**
 * For presses on the canvas or the minimap, whose preventDefault stops the browser from moving
 * focus: focus left outside the board area (board title, tab rename, a header button) would
 * keep catching board keys, so it is blurred; a pending rename commits through its own blur.
 * Overlays inside the board area (text, column and comment editors) keep their own focus
 * rules, but a select there (the Algorithms panel) is blurred too: it keeps board keys
 * (Delete, arrows, tool letters) for itself while focused.
 */
export function blurStrayFocus(boardArea: Element | null | undefined): void {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    (!boardArea?.contains(active) || active.tagName === 'SELECT')
  ) {
    active.blur();
  }
}

/**
 * Whether a board key is left to the focused element. A select has no text to cancel, so
 * Escape on it still reaches the board (it clears an algorithm result, like on a button).
 */
export function leavesKeyAlone(target: EventTarget | null, key: string): boolean {
  if (!isTyping(target)) return false;
  return !(key === 'Escape' && (target as HTMLElement).tagName === 'SELECT');
}
