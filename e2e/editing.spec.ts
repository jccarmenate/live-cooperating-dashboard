import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function newBoard(page: Page, request: APIRequestContext): Promise<string> {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  return path;
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
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('resize, undo and redo a rectangle, seen by a second user', async ({
  page,
  browser,
  request,
}) => {
  const path = await newBoard(page, request);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await page.keyboard.press('r');
  await drag(page, { x: 300, y: 200 }, { x: 460, y: 300 });
  await expect(page.getByText('160 × 100')).toBeVisible();

  const handle = await page.locator('[data-handle=se]').boundingBox();
  if (!handle) throw new Error('se handle not rendered');
  const corner = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await drag(page, corner, { x: corner.x + 60, y: corner.y + 40 });
  await expect(page.getByText('220 × 140')).toBeVisible();
  // The shadow rect is the first <rect> of the shape and has the shape's width.
  await expect(pb.locator('[data-shape-id] rect').first()).toHaveAttribute('width', '220');

  await page.keyboard.press('Control+z');
  await expect(page.getByText('160 × 100')).toBeVisible();
  await expect(pb.locator('[data-shape-id] rect').first()).toHaveAttribute('width', '160');

  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('220 × 140')).toBeVisible();
  await other.close();
});

test('marquee selects several shapes and Delete removes them', async ({ page, request }) => {
  await newBoard(page, request);
  for (const x of [300, 520]) {
    await page.keyboard.press('s');
    await page.mouse.click(x, 300);
    await page.keyboard.type(`note ${x}`);
    await page.keyboard.press('Escape');
  }
  await drag(page, { x: 150, y: 150 }, { x: 750, y: 480 });
  await expect(page.getByTestId('selection-outline')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-shape-id]')).toHaveCount(0);
});

test('draws ellipses, lines and code blocks', async ({ page, request }) => {
  await newBoard(page, request);

  await page.keyboard.press('o');
  await drag(page, { x: 250, y: 200 }, { x: 400, y: 300 });
  await expect(page.locator('[data-shape-id] ellipse')).toHaveCount(2); // shadow + body

  await page.keyboard.press('l');
  await drag(page, { x: 450, y: 200 }, { x: 600, y: 320 });
  await expect(page.locator('[data-shape-id] line')).toHaveCount(2); // stroke + hit area
  await expect(page.locator('[data-handle=start]')).toBeVisible();

  await page.keyboard.press('c');
  await page.mouse.click(400, 480);
  await page.getByTestId('text-editor').fill('const x = 1;');
  await page.keyboard.press('Escape');
  await expect(page.getByText('const x = 1;')).toBeVisible();
});
