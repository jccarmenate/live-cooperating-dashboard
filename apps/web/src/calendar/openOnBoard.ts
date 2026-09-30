/**
 * "Open on board": closes the editor and shows the linked sticky. The sticky may have gone
 * since the button was drawn; then the user is told so.
 */
export function openOnBoard(
  ctl: { closeEditor(): void },
  board: { revealShape(pageId: string, shapeId: string): boolean },
  link: { pageId: string; shapeId: string },
  notify: (message: string) => void,
): void {
  ctl.closeEditor();
  if (!board.revealShape(link.pageId, link.shapeId)) notify('Sticky deleted');
}
