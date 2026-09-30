import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

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

  // A selected sticky: the properties bar stays inside the screen.
  await page.getByTestId('tool-sticky').tap();
  await page.touchscreen.tap(260, 320);
  await page.keyboard.type('hi');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').tap();
  await page.locator('[data-shape-id]').first().tap();
  await onScreen(page, page.getByTestId('props-bar'));

  // The comments panel sits beside the toolbar and above the properties bar.
  await page.getByTestId('comments-toggle').tap();
  const panel = await onScreen(page, page.getByTestId('comments-panel'));
  const tools = await onScreen(page, page.getByRole('navigation', { name: 'Tools' }));
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
