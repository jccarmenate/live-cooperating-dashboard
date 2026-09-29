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
 * Whether a board key is left to the focused element. A select has no text to cancel, so
 * Escape on it still reaches the board (it clears an algorithm result, like on a button).
 */
export function leavesKeyAlone(target: EventTarget | null, key: string): boolean {
  if (!isTyping(target)) return false;
  return !(key === 'Escape' && (target as HTMLElement).tagName === 'SELECT');
}
