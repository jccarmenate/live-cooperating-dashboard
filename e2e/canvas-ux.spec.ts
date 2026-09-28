import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

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

async function sticky(page: Page, x: number, y: number, text: string) {
  await page.keyboard.press('s');
  await page.mouse.click(x, y);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('the context menu restyles, locks and deletes; the properties bar unlocks', async ({
  page,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await sticky(page, 400, 320, 'Menu target');
  const shape = page.locator('[data-shape-id]').first();

  await page.mouse.click(800, 560);
  await page.mouse.click(400, 320, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('selection-outline')).toHaveCount(1);
  await page.getByTestId('menu-fill-cobalt').click();
  await expect(shape.locator('rect').nth(1)).toHaveAttribute('fill', '#3B3BF5');

  await page.mouse.click(400, 320, { button: 'right' });
  await page.getByTestId('menu-lock').click();
  await expect(page.getByTestId('lock-badge')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-shape-id]')).toHaveCount(1);
  const before = await shape.boundingBox();
  await drag(page, { x: 400, y: 320 }, { x: 520, y: 400 });
  expect(await shape.boundingBox()).toEqual(before);

  await page.getByTestId('props-lock').click();
  await expect(page.getByTestId('lock-badge')).toHaveCount(0);
  await page.mouse.click(400, 320, { button: 'right' });
  await page.getByTestId('menu-delete').click();
  await expect(page.locator('[data-shape-id]')).toHaveCount(0);
});

test('copy, paste here, duplicate, undo, and pastes from the system clipboard', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await sticky(page, 320, 320, 'Copy me');
  await page.mouse.click(320, 320, { button: 'right' });
  await page.getByTestId('menu-copy').click();
  await page.mouse.click(760, 460, { button: 'right' });
  await page.getByTestId('menu-paste-here').click();
  const shapes = page.locator('[data-shape-id]');
  await expect(shapes).toHaveCount(2);
  await expect(pb.getByText('Copy me')).toHaveCount(2);

  await page.keyboard.press('Control+d');
  await expect(shapes).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(shapes).toHaveCount(2);
  await expect(page.getByTestId('toast').filter({ hasText: 'Undone' })).toBeVisible();

  // Text from another app becomes a sticky.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'From elsewhere');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.getByText('From elsewhere')).toBeVisible();

  // A keyboard copy writes a Relay clip.
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    document.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
    );
    return data.getData('text/plain');
  });
  expect(copied.startsWith('relay-clip:v1:')).toBe(true);
  await other.close();
});

test('help dialog, focus trap and the empty-page hint', async ({ page, request }) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await expect(page.getByTestId('empty-hint')).toBeVisible();

  await page.keyboard.press('?');
  await expect(page.getByTestId('help-dialog')).toContainText('Duplicate');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help-dialog')).toHaveCount(0);
  await page.getByTestId('help-button').click();
  await expect(page.getByTestId('help-dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTestId('share-open').click();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
  ).toBe(true);
  await page.keyboard.press('Escape');

  await sticky(page, 400, 320, 'First');
  await expect(page.getByTestId('empty-hint')).toHaveCount(0);
});

test('viewers get only Copy and Zoom to fit, and no properties bar', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await sticky(page, 400, 320, 'Read only');
  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  await expect(viewer.getByText('Read only')).toBeVisible();
  const box = await viewer.locator('[data-shape-id]').first().boundingBox();
  if (!box) throw new Error('sticky not rendered for the viewer');
  await viewer.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(viewer.getByRole('menuitem')).toHaveCount(2);
  await expect(viewer.getByTestId('menu-copy')).toBeVisible();
  await expect(viewer.getByTestId('menu-fit')).toBeVisible();
  await expect(viewer.getByTestId('props-bar')).toHaveCount(0);
  await viewerCtx.close();
});

test('a remote page delete shows a toast; hash edits switch pages', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-board').click();
  const tabsB = pb.getByTestId('page-tab');
  await expect(tabsB).toHaveCount(2);
  await tabsB.nth(1).click();
  await expect(tabsB.nth(1)).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('page-tab').nth(1).click({ button: 'right' });
  await page.getByTestId('page-menu-delete').click();
  await page.getByTestId('confirm-ok').click();
  await expect(
    pb.getByTestId('toast').filter({ hasText: 'The page you were on was deleted' }),
  ).toBeVisible();

  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-board').click();
  const tabs = page.getByTestId('page-tab');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => {
    window.location.hash = window.location.hash.replace(/p=[^&]+/, 'p=main');
  });
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await other.close();
});
