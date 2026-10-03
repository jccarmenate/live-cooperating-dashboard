import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function newBoard(page: Page, request: APIRequestContext) {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  await page.goto(`/r/${roomId}#k=${editKey}`);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

/** The element's box, asserted to lie wholly inside the viewport. */
async function onScreen(page: Page, target: Locator) {
  const b = await target.boundingBox();
  const vp = page.viewportSize();
  if (!b || !vp) throw new Error('no box');
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
  return b;
}

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Raw touch input through CDP: fingers get ids by their position in `points`. */
async function fingers(page: Page, context: BrowserContext) {
  const cdp = await context.newCDPSession(page);
  const touch = (type: string, points: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  return {
    touch,
    async tap(x: number, y: number) {
      await touch('touchStart', [[x, y]]);
      await touch('touchEnd', []);
    },
  };
}

test('on a tablet the full layout fits and takes touch on the board', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  const { touch, tap } = await fingers(page, context);

  // The desktop header, with its words, and the touch-only toolbar toggle.
  await expect(page.getByText('RELAY', { exact: true })).toBeVisible();
  await expect(page.getByTestId('conn-status')).toBeVisible();
  await expect(page.getByTestId('comments-toggle').getByText('Comments ·')).toBeVisible();
  for (const id of ['vote-start', 'share-open', 'online-count', 'undo', 'redo', 'multi-select']) {
    await onScreen(page, page.getByTestId(id));
  }
  const tools = await onScreen(page, page.getByRole('navigation', { name: 'Tools' }));
  expect(tools.width).toBeLessThan(60); // one column

  // A sticky by tap; its properties bar clears the toolbar; the panel clears the minimap.
  await page.getByTestId('tool-sticky').tap();
  await tap(400, 400);
  await page.keyboard.type('Tablet');
  await page.keyboard.press('Escape');
  const bar = await onScreen(page, page.getByTestId('props-bar'));
  expect(overlap(bar, tools)).toBe(false);
  await page.getByTestId('comments-toggle').tap();
  const panel = await onScreen(page, page.getByTestId('comments-panel'));
  const minimap = await onScreen(page, page.getByTestId('minimap'));
  expect(overlap(panel, minimap)).toBe(false);
  expect(overlap(panel, tools)).toBe(false);
  await page.getByTestId('comments-toggle').tap();

  // Press and hold for the menu; two fingers to zoom.
  await touch('touchStart', [[400, 400]]);
  await onScreen(page, page.getByTestId('context-menu'));
  await touch('touchEnd', []);
  await page.keyboard.press('Escape');
  await touch('touchStart', [[300, 700]]);
  await touch('touchStart', [
    [300, 700],
    [400, 700],
  ]);
  await touch('touchMove', [
    [250, 700],
    [450, 700],
  ]);
  await touch('touchEnd', []);
  await expect(page.getByTestId('zoom-reset')).toHaveText('200%');
  await expect(page.locator('[data-shape-id]')).toHaveCount(1);
});

test('on a tablet the sheet and the calendar work by touch, in both orientations', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  const { tap } = await fingers(page, context);

  // Sheet: a tap selects, a second tap edits.
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-sheet').tap();
  await page.getByTestId('cell-B2').tap();
  await expect(page.getByTestId('sheet-address')).toHaveText('B2');
  await page.getByTestId('cell-B2').tap();
  await expect(page.getByTestId('cell-editor')).toBeFocused();
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cell-B2')).toHaveText('5');

  // Calendar: a one-row header with the time zone; a week whose seven days all fit.
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-calendar').tap();
  const oneRow = async () => {
    const prev = await page.getByTestId('cal-prev').boundingBox();
    const add = await page.getByTestId('cal-new').boundingBox();
    return Math.abs((prev?.y ?? 0) - (add?.y ?? 100)) < 4;
  };
  expect(await oneRow()).toBe(true);
  await expect(page.getByTestId('cal-zone')).toBeVisible();
  await page.getByTestId('cal-view-week').tap();
  const scroller = page.locator('[data-week-scroller]');
  const cols = page.getByTestId('cal-week-col');
  expect((await cols.first().boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(88);
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await onScreen(page, page.getByTestId('cal-view-week'));

  // A tap on an empty slot creates an event.
  const col = await cols.nth(3).boundingBox();
  if (!col) throw new Error('no column');
  await tap(col.x + col.width / 2, 600);
  await expect(page.getByTestId('cal-editor')).toBeVisible();
  await onScreen(page, page.getByRole('dialog'));
  await page.getByTestId('cal-cancel').tap();

  // Landscape: the same, wider.
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await oneRow()).toBe(true);
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await page.getByTestId('page-tab').first().tap();
  await onScreen(page, page.getByTestId('help-button'));
  await onScreen(page, page.getByTestId('minimap'));
});
