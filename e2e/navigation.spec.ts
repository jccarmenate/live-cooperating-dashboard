import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function newBoard(page: Page, request: APIRequestContext): Promise<string> {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  return path;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('ctrl+wheel zooms, the controls step and reset, and the camera survives a reload', async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  const reset = page.getByTestId('zoom-reset');
  await expect(reset).toHaveText('100%');

  await page.mouse.move(640, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100); // capped at 50 → ×e^0.5
  await page.keyboard.up('Control');
  await expect(reset).toHaveText('165%');

  await page.getByTestId('zoom-in').click();
  await expect(reset).toHaveText('206%');

  // A real reload: goto() to the same URL with a #fragment would be a same-document navigation.
  await page.reload();
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
  await expect(reset).toHaveText('206%');
  await reset.click();
  await expect(reset).toHaveText('100%');
});

test('space-drag and middle-drag pan the camera; the readout tracks world coordinates', async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  await page.keyboard.press('r');
  await drag(page, { x: 400, y: 300 }, { x: 520, y: 380 });
  const shape = page.locator('[data-shape-id]').first();
  const before = await shape.boundingBox();
  if (!before) throw new Error('rect not rendered');

  await page.mouse.move(400, 300);
  const coords = page.getByTestId('coords');
  const start = await coords.textContent();

  await page.keyboard.down('Space');
  await drag(page, { x: 800, y: 500 }, { x: 900, y: 550 });
  await page.keyboard.up('Space');
  await expect(page.getByTestId('marquee')).toHaveCount(0);
  await expect
    .poll(async () => Math.round((await shape.boundingBox())?.x ?? 0))
    .toBe(Math.round(before.x + 100));

  await page.mouse.move(800, 500);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(760, 480, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await expect
    .poll(async () => Math.round((await shape.boundingBox())?.x ?? 0))
    .toBe(Math.round(before.x + 60));
  await expect
    .poll(async () => Math.round((await shape.boundingBox())?.y ?? 0))
    .toBe(Math.round(before.y + 30));

  // The same world point is now 60 px right and 30 px down on screen.
  await page.mouse.move(460, 330);
  await expect(coords).toHaveText(start ?? '');
});

test('the minimap navigates and shows the peer viewport; a peer typing is visible', async ({
  page,
  browser,
  request,
}) => {
  const path = await newBoard(page, request);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);
  await expect(page.getByTestId('minimap-peer')).toHaveCount(1);

  await page.keyboard.press('r');
  await drag(page, { x: 400, y: 300 }, { x: 520, y: 380 });
  const shape = page.locator('[data-shape-id]').first();
  const before = await shape.boundingBox();
  const map = await page.getByTestId('minimap').boundingBox();
  if (!before || !map) throw new Error('not rendered');
  await page.mouse.click(map.x + 12, map.y + 12);
  await expect.poll(async () => (await shape.boundingBox())?.x).not.toBe(before.x);

  await pb.keyboard.press('s');
  await pb.mouse.click(700, 450);
  await pb.keyboard.type('hola');
  await expect(page.getByTestId('typing-indicator')).toContainText('typing…');
  await pb.keyboard.press('Escape');
  await expect(page.getByTestId('typing-indicator')).toHaveCount(0);
  await other.close();
});

test('a frame drawn over a sticky adopts it; Enter commits the frame title', async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  await page.keyboard.press('s');
  await page.mouse.click(270, 330);
  await page.keyboard.type('Adopt me');
  await page.keyboard.press('Escape');

  await page.keyboard.press('f');
  await drag(page, { x: 150, y: 120 }, { x: 870, y: 560 });
  await expect(page.getByText(/went well · 1/i)).toBeVisible();

  await page.mouse.dblclick(500, 138); // the title band spans y 120..156
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Retro');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('text-editor')).toHaveCount(0);
  await expect(page.getByText('Retro', { exact: true })).toBeVisible();
});

test('a space-held double-click pans and never opens the text editor', async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  await page.keyboard.press('s');
  await page.mouse.click(400, 300);
  await page.keyboard.type('Keep me');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-editor')).toHaveCount(0);

  await page.keyboard.down('Space');
  await page.mouse.dblclick(400, 300);
  await page.keyboard.up('Space');

  // Space's auto-repeat would otherwise type spaces into an editor a stray doubleClick opened.
  await expect(page.getByTestId('text-editor')).toHaveCount(0);
  await expect(page.getByText('Keep me', { exact: true })).toBeVisible();
});
