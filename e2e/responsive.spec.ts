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

test('on a phone the header, panels and properties bar fit the screen', async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  // The logo keeps its square; the controls keep their accessible text.
  const logo = await onScreen(page, page.getByRole('link', { name: 'Relay home' }));
  expect(logo.width).toBeCloseTo(logo.height, 0);
  for (const id of ['vote-start', 'comments-toggle', 'share-open', 'online-count']) {
    const b = await onScreen(page, page.getByTestId(id));
    expect(b.height).toBeLessThan(32); // one line, not wrapped
  }
  await expect(page.getByTestId('comments-toggle')).toHaveText('Comments · 0');
  await expect(page.getByTestId('online-count')).toHaveText('1 online');

  await page.getByTestId('tool-sticky').tap();
  await page.touchscreen.tap(260, 320);
  await page.keyboard.type('hi');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').tap();
  await page.locator('[data-shape-id]').first().tap();
  // A selected sticky: the properties bar stays inside the screen and off the toolbar.
  const bar = await onScreen(page, page.getByTestId('props-bar'));
  const tools = await onScreen(page, page.getByRole('navigation', { name: 'Tools' }));
  expect(bar.x).toBeGreaterThanOrEqual(tools.x + tools.width);

  // The comments panel sits beside the toolbar and above the properties bar.
  await page.getByTestId('comments-toggle').tap();
  const panel = await onScreen(page, page.getByTestId('comments-panel'));
  expect(panel.x).toBeGreaterThanOrEqual(tools.x + tools.width);
  const zIndex = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el).zIndex));
  expect(await zIndex(page.getByTestId('comments-panel'))).toBeGreaterThanOrEqual(
    await zIndex(page.getByTestId('props-bar')),
  );
});

test('in landscape the toolbar wraps and every tool stays reachable', async ({ page, request }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await newBoard(page, request);
  const tools = await onScreen(page, page.getByRole('navigation', { name: 'Tools' }));
  const zoom = await page.getByTestId('zoom-out').boundingBox();
  expect(tools.y + tools.height).toBeLessThanOrEqual(zoom?.y ?? 0);
  await onScreen(page, page.getByTestId('help-button'));
  await page.getByTestId('help-button').tap();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('two fingers pan and pinch-zoom the board instead of drawing', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  await expect(page.getByTestId('zoom-reset')).toHaveText('100%');
  await page.getByTestId('tool-shapes').tap();
  await page.getByTestId('tool-rect').tap();

  const cdp = await context.newCDPSession(page);
  const touch = (type: string, points: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  // The first finger starts drawing; the second turns it into a pinch that spreads 2×.
  await touch('touchStart', [[150, 400]]);
  await touch('touchMove', [[155, 405]]);
  await touch('touchStart', [
    [155, 405],
    [255, 405],
  ]);
  await touch('touchMove', [
    [130, 405],
    [280, 405],
  ]);
  await touch('touchMove', [
    [105, 405],
    [305, 405],
  ]);
  // One finger lifts, the other keeps moving: it must not start drawing.
  await touch('touchEnd', [[305, 405]]);
  await touch('touchMove', [[250, 500]]);
  await touch('touchEnd', []);

  await expect(page.getByTestId('zoom-reset')).toHaveText('200%');
  await expect(page.locator('[data-shape-id]')).toHaveCount(0);
  await expect(page.getByTestId('marquee')).toHaveCount(0);

  // One finger alone still draws.
  await page.getByTestId('tool-shapes').tap();
  await page.getByTestId('tool-rect').tap();
  await touch('touchStart', [[120, 300]]);
  await touch('touchMove', [[180, 350]]);
  await touch('touchMove', [[240, 400]]);
  await touch('touchEnd', []);
  await expect(page.locator('[data-shape-id]')).toHaveCount(1);
});

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

test('a finger places stickies on lift, holds for the menu and double-taps to edit', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  const { touch, tap } = await fingers(page, context);
  const shapes = page.locator('[data-shape-id]');

  // The sticky tool waits for the finger to lift.
  await page.getByTestId('tool-sticky').tap();
  await touch('touchStart', [[250, 260]]);
  await page.waitForTimeout(100);
  await expect(shapes).toHaveCount(0);
  await touch('touchEnd', []);
  await expect(shapes).toHaveCount(1);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Plan');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-editor')).toHaveCount(0);

  // Press and hold on the sticky: the canvas menu, which stays open after the finger lifts.
  await touch('touchStart', [[250, 260]]);
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await touch('touchEnd', []);
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('context-menu')).toHaveCount(0);

  // Holding with the sticky tool opens the menu and places nothing.
  await page.getByTestId('tool-sticky').tap();
  await touch('touchStart', [[250, 520]]);
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await touch('touchEnd', []);
  await expect(shapes).toHaveCount(1);
  await page.keyboard.press('Escape');

  // A double tap edits the sticky's text.
  await page.getByTestId('tool-select').tap();
  await tap(250, 260);
  await tap(250, 260);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await expect(page.getByTestId('text-editor')).toHaveValue('Plan');
});

test('the Add to selection toggle stands in for Shift on touch screens', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  const { tap } = await fingers(page, context);
  for (const y of [260, 520]) {
    await page.getByTestId('tool-sticky').tap();
    await tap(250, y);
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('[data-shape-id]')).toHaveCount(2);
  const outlines = page.getByTestId('selection-outline');

  await page.getByTestId('tool-select').tap();
  await tap(250, 260);
  await tap(250, 520);
  await expect(outlines).toHaveCount(1);

  const toggle = page.getByTestId('multi-select');
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await tap(250, 260);
  await expect(outlines).toHaveCount(2);
  await toggle.tap();
  await tap(250, 260);
  await expect(outlines).toHaveCount(1);
});

test('tabs open their menu on a long press and move without dragging; help lists gestures', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  const { touch } = await fingers(page, context);
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-board').tap();
  const tabs = page.getByTestId('page-tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).not.toHaveAttribute('draggable', 'true');

  const main = (await tabs.nth(0).textContent()) ?? '';
  const first = await tabs.nth(0).boundingBox();
  if (!first) throw new Error('no tab');
  await touch('touchStart', [[first.x + 20, first.y + 10]]);
  await expect(page.getByTestId('page-menu-left')).toBeDisabled();
  await touch('touchEnd', []);
  await page.getByTestId('page-menu-right').tap();
  await expect(tabs.nth(1)).toHaveText(main);

  await page.getByTestId('help-button').tap();
  await expect(page.getByRole('dialog', { name: 'Gestures and shortcuts' })).toBeVisible();
  await expect(page.getByTestId('help-dialog')).toContainText('Pan and pinch to zoom');
});

test('on a phone taps select and edit cells, drags scroll, and a held finger selects a range', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  const { touch, tap } = await fingers(page, context);
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-sheet').tap();
  const address = page.getByTestId('sheet-address');
  const center = async (id: string): Promise<[number, number]> => {
    const b = await page.getByTestId(id).boundingBox();
    if (!b) throw new Error(`no ${id}`);
    return [b.x + b.width / 2, b.y + b.height / 2];
  };

  // A tap selects; a second tap on the selected cell edits it, with the keyboard's focus.
  const b2 = await center('cell-B2');
  await tap(...b2);
  await expect(address).toHaveText('B2');
  await expect(page.getByTestId('cell-editor')).toHaveCount(0);
  await tap(...b2);
  await expect(page.getByTestId('cell-editor')).toBeFocused();
  await page.keyboard.type('42');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cell-B2')).toHaveText('42');
  await expect(address).toHaveText('B3');

  // Press, hold and drag: a range from A2 to B4.
  const a2 = await center('cell-A2');
  const b4 = await center('cell-B4');
  await touch('touchStart', [a2]);
  await page.waitForTimeout(700);
  await touch('touchMove', [[(a2[0] + b4[0]) / 2, (a2[1] + b4[1]) / 2]]);
  await touch('touchMove', [b4]);
  await touch('touchEnd', []);
  await expect(address).toHaveText('A2');
  const sel = await page.getByTestId('sheet-selection').boundingBox();
  const cell = await page.getByTestId('cell-A2').boundingBox();
  expect(Math.round((sel?.height ?? 0) / (cell?.height ?? 1))).toBe(3);
  expect(sel?.width ?? 0).toBeGreaterThan((cell?.width ?? 0) * 1.5);

  // Press and hold on a row header: its menu.
  await touch('touchStart', [await center('row-header-3')]);
  await expect(page.getByTestId('sheet-menu-insert-above')).toBeVisible();
  await touch('touchEnd', []);
  await page.keyboard.press('Escape');

  // A drag scrolls the grid and leaves the selection where it was.
  await tap(...(await center('cell-A1')));
  await expect(address).toHaveText('A1');
  const grid = page.getByTestId('sheet-grid');
  await touch('touchStart', [[200, 600]]);
  for (const y of [560, 500, 420, 340, 300]) await touch('touchMove', [[200, y]]);
  await touch('touchEnd', []);
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  await expect(address).toHaveText('A1');
});

test('on a phone the tab row shows it scrolls, and a vote fits the header', async ({
  page,
  request,
}) => {
  await newBoard(page, request);
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('page-add').tap();
    await page.getByTestId('page-add-board').tap();
  }
  const tabs = page.getByTestId('page-tab');
  await expect(tabs).toHaveCount(6);
  // The new, active tab is scrolled into view; earlier tabs hide on the left.
  await onScreen(page, tabs.nth(5));
  await expect(page.getByTestId('tabs-more-left')).toBeVisible();
  await tabs.nth(5).evaluate((el) => el.closest('nav')?.scrollTo({ left: 0 }));
  await expect(page.getByTestId('tabs-more-right')).toBeVisible();
  await expect(page.getByTestId('tabs-more-left')).toHaveCount(0);

  await page.getByTestId('vote-start').tap();
  await page.getByTestId('vote-3m').tap();
  await expect(page.getByTestId('vote-status')).toContainText('VOTE OPEN · 2:5');
  for (const id of ['vote-status', 'vote-end', 'comments-toggle', 'share-open', 'online-count']) {
    const b = await onScreen(page, page.getByTestId(id));
    expect(b.height).toBeLessThan(32);
  }
  await expect(page.getByTestId('share-open')).toHaveText('Share');
});

test('on a phone the week scrolls both ways, taps create and open events, a hold moves one', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  const { touch, tap } = await fingers(page, context);
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-calendar').tap();
  await page.getByTestId('cal-view-week').tap();
  const scroller = page.locator('[data-week-scroller]');
  const today = await page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const col = page.locator(`[data-testid="cal-week-col"][data-date="${today}"]`);

  // Day columns keep a usable width, the days scroll sideways, and today is in view.
  const c = await col.boundingBox();
  if (!c) throw new Error('no column');
  expect(c.width).toBeGreaterThanOrEqual(80);
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(c.x).toBeGreaterThanOrEqual(56);
  expect(c.x + c.width).toBeLessThanOrEqual(375);
  // The hour labels stay put when the days scroll.
  const labelsLeft = await scroller.evaluate((el) => {
    const before = el.scrollLeft;
    el.scrollLeft = before === 150 ? 100 : 150;
    const labels = el.querySelector('[data-testid="cal-week-col"]')?.previousElementSibling;
    const left = (labels?.getBoundingClientRect().left ?? -1) - el.getBoundingClientRect().left;
    el.scrollLeft = before;
    return left;
  });
  expect(labelsLeft).toBe(0);

  // A vertical swipe scrolls the hours; it creates nothing.
  const at = async (): Promise<[number, number]> => {
    const b = await col.boundingBox();
    if (!b) throw new Error('no column');
    return [b.x + b.width / 2, 0];
  };
  const [x] = await at();
  const top = await scroller.evaluate((el) => el.scrollTop);
  await touch('touchStart', [[x, 600]]);
  for (const y of [570, 520, 460, 400, 360]) await touch('touchMove', [[x, y]]);
  await touch('touchEnd', []);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(top + 100);
  await expect(page.getByTestId('cal-editor')).toHaveCount(0);
  await expect(page.getByTestId('cal-drag-preview')).toHaveCount(0);

  // A tap on an empty slot creates a one-hour event there.
  await tap(x, 450);
  await expect(page.getByTestId('cal-editor')).toBeVisible();
  const start = await page.getByTestId('cal-start-time').inputValue();
  const end = await page.getByTestId('cal-end-time').inputValue();
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  expect(minutes(end) - minutes(start)).toBe(60);
  await page.getByTestId('cal-title-input').fill('Standup');
  await page.getByTestId('cal-save').tap();
  await expect(page.getByTestId('cal-editor')).toHaveCount(0);
  const event = page.getByTestId('cal-event').filter({ hasText: 'Standup' });
  await expect(event).toBeVisible();

  // A saved event starts selected: clear that, then a tap selects it and a second opens it.
  await page.keyboard.press('Escape');
  await expect(event).not.toHaveAttribute('data-selected', 'true');
  const e1 = await event.boundingBox();
  if (!e1) throw new Error('no event');
  await tap(e1.x + e1.width / 2, e1.y + 10);
  await expect(event).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('cal-editor')).toHaveCount(0);
  await page.waitForTimeout(600);
  await tap(e1.x + e1.width / 2, e1.y + 10);
  await expect(page.getByTestId('cal-editor')).toBeVisible();
  await page.getByTestId('cal-cancel').tap();
  await expect(page.getByTestId('cal-editor')).toHaveCount(0);

  // Press, hold and drag: the event moves one hour later.
  const from: [number, number] = [e1.x + e1.width / 2, e1.y + 10];
  await touch('touchStart', [from]);
  await page.waitForTimeout(700);
  for (const dy of [12, 24, 36, 48]) await touch('touchMove', [[from[0], from[1] + dy]]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await event.boundingBox())?.y ?? 0).toBeGreaterThan(e1.y + 40);
  await tap(from[0], from[1] + 58);
  await tap(from[0], from[1] + 58);
  await expect(page.getByTestId('cal-start-time')).toHaveValue(
    `${String(Math.floor((minutes(start) + 60) / 60)).padStart(2, '0')}:${start.slice(3, 5)}`,
  );
});

test('on a phone the month view creates on a tap and opens the selected event on a second', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  const { tap } = await fingers(page, context);
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-calendar').tap();
  const day = page.getByTestId('cal-day').nth(16);
  const d = await day.boundingBox();
  if (!d) throw new Error('no day');
  await tap(d.x + d.width / 2, d.y + d.height - 8);
  await page.getByTestId('cal-title-input').fill('Retro');
  await page.getByTestId('cal-save').tap();
  const event = page.getByTestId('cal-event').filter({ hasText: 'Retro' });
  await expect(event).toBeVisible();
  const e = await event.boundingBox();
  if (!e) throw new Error('no event');
  // A saved event starts selected: clear that first.
  await page.keyboard.press('Escape');
  await expect(event).not.toHaveAttribute('data-selected', 'true');
  await tap(e.x + e.width / 2, e.y + e.height / 2);
  await expect(event).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('cal-editor')).toHaveCount(0);
  // Later than a double tap: the browser's dblclick plays no part.
  await page.waitForTimeout(600);
  await tap(e.x + e.width / 2, e.y + e.height / 2);
  await expect(page.getByTestId('cal-title-input')).toHaveValue('Retro');
});

test('on a phone header menus move rows and columns, and a swipe rolls the month', async ({
  page,
  context,
  request,
}) => {
  await newBoard(page, request);
  const { touch } = await fingers(page, context);
  const center = async (id: string): Promise<[number, number]> => {
    const b = await page.getByTestId(id).boundingBox();
    if (!b) throw new Error(`no ${id}`);
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const hold = async (id: string) => {
    await touch('touchStart', [await center(id)]);
    await page.waitForTimeout(700);
    await touch('touchEnd', []);
  };

  // Rows and columns move from their header menus.
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-sheet').tap();
  // A1 starts selected, so one tap edits it.
  await page.getByTestId('cell-A1').tap();
  await expect(page.getByTestId('cell-editor')).toBeFocused();
  await page.keyboard.type('top');
  await page.keyboard.press('Enter');
  await hold('row-header-1');
  await expect(page.getByTestId('sheet-menu-move-up')).toBeDisabled();
  await page.getByTestId('sheet-menu-move-down').tap();
  await expect(page.getByTestId('cell-A2')).toHaveText('top');
  await hold('col-header-A');
  await expect(page.getByTestId('sheet-menu-move-left')).toBeDisabled();
  await page.getByTestId('sheet-menu-move-right').tap();
  await expect(page.getByTestId('cell-B2')).toHaveText('top');

  // A swipe up the month grid shows later weeks, a row per week.
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-calendar').tap();
  const first = page.getByTestId('cal-day').first();
  const before = (await first.getAttribute('data-date')) ?? '';
  const row = ((await page.getByTestId('cal-day').first().boundingBox())?.height ?? 0) + 1;
  const x = 200;
  const y = 600;
  await touch('touchStart', [[x, y]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[x, y - (i * row * 2.2) / 8]]);
  await touch('touchEnd', []);
  const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
  await expect
    .poll(async () => days(before, (await first.getAttribute('data-date')) ?? ''))
    .toBe(14);
  await expect(page.getByTestId('cal-editor')).toHaveCount(0);
});

test('in landscape comments stay on the board, and sheet and calendar bars keep to one row', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await newBoard(page, request);

  // A comment at the right edge: the composer and its thread open inside the screen.
  await page.getByTestId('tool-comment').tap();
  const board = await page.getByTestId('canvas').boundingBox();
  if (!board) throw new Error('no canvas');
  await page.touchscreen.tap(board.x + board.width - 30, board.y + board.height / 2);
  await onScreen(page, page.getByTestId('comment-composer').locator('..'));
  await page.getByTestId('comment-composer').fill('Edge case');
  await page.keyboard.press('Enter');
  await onScreen(page, page.getByTestId('comment-thread'));

  // Sheet: the format and formula bars share a row.
  await page.keyboard.press('Escape');
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-sheet').tap();
  const bold = await page.getByTestId('sheet-bold').boundingBox();
  const formula = await page.getByTestId('formula-bar').boundingBox();
  expect(Math.abs((bold?.y ?? 0) - (formula?.y ?? 100))).toBeLessThan(20);

  // Calendar: one header row; the time zone moves into the ⋯ menu.
  await page.getByTestId('page-add').tap();
  await page.getByTestId('page-add-calendar').tap();
  const prev = await page.getByTestId('cal-prev').boundingBox();
  const add = await page.getByTestId('cal-new').boundingBox();
  expect(Math.abs((prev?.y ?? 0) - (add?.y ?? 100))).toBeLessThan(4);
  await expect(page.getByTestId('cal-zone')).toBeHidden();
  await page.getByTestId('cal-menu').tap();
  await expect(page.getByTestId('cal-menu-zone')).toContainText('Times in');
});
