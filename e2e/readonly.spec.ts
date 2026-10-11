import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function newRoom(request: APIRequestContext) {
  const res = await request.post(`${SYNC}/api/rooms`);
  return (await res.json()) as { roomId: string; editKey: string; viewKey: string };
}

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("a viewer cannot change the board, not even in the viewer's own copy", async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await page.keyboard.press('s');
  await page.mouse.click(400, 320);
  await page.keyboard.type('Read only');
  await page.keyboard.press('Escape');

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  const shapes = viewer.locator('[data-shape-id]');
  await expect(viewer.getByText('Read only')).toBeVisible();

  // No tool that creates, and the key that would pick one draws nothing.
  await expect(viewer.getByTestId('tool-select')).toBeVisible();
  await expect(viewer.getByTestId('tool-sticky')).toHaveCount(0);
  await expect(viewer.getByTestId('tool-shapes')).toHaveCount(0);
  await viewer.keyboard.press('r');
  await drag(viewer, { x: 1000, y: 560 }, { x: 1140, y: 660 });
  await expect(shapes).toHaveCount(1);

  // Pressing the sticky selects it. Dragging does not move it, and no resize handle shows.
  const box = await shapes.first().boundingBox();
  if (!box) throw new Error('sticky not rendered for the viewer');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(viewer, centre, { x: centre.x - 160, y: centre.y - 120 });
  await expect(viewer.getByTestId('selection-outline')).toHaveCount(1);
  expect(await shapes.first().boundingBox()).toEqual(box);
  await expect(viewer.locator('[data-handle]')).toHaveCount(0);

  // A double-click opens no editor.
  await viewer.mouse.dblclick(centre.x, centre.y);
  await expect(viewer.getByTestId('text-editor')).toHaveCount(0);

  // Nothing was kept in the viewer's copy either: after a reload the board is the room's.
  await viewer.reload();
  await expect(viewer.getByText('Read only')).toBeVisible();
  await expect(shapes).toHaveCount(1);
  await expect(page.locator('[data-shape-id]')).toHaveCount(1);
  await viewerCtx.close();
});
