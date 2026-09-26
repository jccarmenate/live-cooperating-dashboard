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

test('connectors attach, follow their shapes, switch routing and die with their shapes', async ({
  page,
  browser,
  request,
}) => {
  const path = await newBoard(page, request);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await page.keyboard.press('r');
  await drag(page, { x: 200, y: 200 }, { x: 320, y: 280 });
  await page.keyboard.press('r');
  await drag(page, { x: 600, y: 400 }, { x: 720, y: 480 });

  await page.keyboard.press('a');
  await drag(page, { x: 260, y: 240 }, { x: 660, y: 440 });
  const line = page.locator('[data-connector-id] polyline').first();
  await expect(line).toHaveCount(1);
  await expect(pb.locator('[data-connector-id]')).toHaveCount(1);

  const before = await line.getAttribute('points');
  await drag(page, { x: 660, y: 420 }, { x: 660, y: 560 });
  await expect(line).not.toHaveAttribute('points', before ?? '');

  // Select the connector by clicking its middle, then toggle elbow routing.
  const box = await page.locator('[data-connector-id]').boundingBox();
  if (!box) throw new Error('connector not rendered');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('e');
  await expect
    .poll(async () => ((await line.getAttribute('points')) ?? '').trim().split(/\s+/).length)
    .toBeGreaterThanOrEqual(3);

  await page.mouse.click(260, 240);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-connector-id]')).toHaveCount(0);
  await expect(pb.locator('[data-connector-id]')).toHaveCount(0);
  await other.close();
});

test('frames count, adopt and carry their stickies; columns can be renamed', async ({
  page,
  request,
}) => {
  await newBoard(page, request);

  await page.keyboard.press('f');
  await drag(page, { x: 150, y: 120 }, { x: 870, y: 560 });
  await expect(page.getByText(/went well · 0/i)).toBeVisible();

  // Column 1 spans x 150..390 on screen; its body starts under the title band + header.
  await page.keyboard.press('s');
  await page.mouse.click(270, 330);
  await page.keyboard.type('Shipped offline mode');
  await page.keyboard.press('Escape');
  await expect(page.getByText(/went well · 1/i)).toBeVisible();

  // Move the sticky into the third column.
  await drag(page, { x: 270, y: 280 }, { x: 750, y: 280 });
  await expect(page.getByText(/went well · 0/i)).toBeVisible();
  await expect(page.getByText(/actions · 1/i)).toBeVisible();

  // Drag the frame by its title band: the sticky travels with it.
  const sticky = page.getByText('Shipped offline mode');
  const beforeBox = await sticky.boundingBox();
  await drag(page, { x: 500, y: 135 }, { x: 560, y: 175 });
  await expect
    .poll(async () => Math.round(((await sticky.boundingBox())?.x ?? 0) - (beforeBox?.x ?? 0)))
    .toBe(60);

  // Rename the middle column.
  await page.getByText(/to improve · 0/i).dblclick();
  const editor = page.getByTestId('column-editor');
  await expect(editor).toBeFocused();
  await editor.fill('Blockers');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/blockers · 0/i)).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText(/to improve · 0/i)).toBeVisible();
});
