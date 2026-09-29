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

test('generate a family and an edge list, then run algorithms', async ({
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

  await page.keyboard.press('g');
  await expect(page.getByTestId('graph-menu')).toBeVisible();
  await page.getByTestId('graph-new').click();
  await page.getByTestId('graph-family').selectOption('complete');
  await page.getByTestId('graph-n').fill('5');
  await page.getByTestId('graph-create').click();
  await expect(page.getByTestId('graph-dialog')).toHaveCount(0);
  await expect(page.locator('[data-shape-id] ellipse')).not.toHaveCount(0);
  await expect(pb.locator('[data-connector-id]')).toHaveCount(10);

  // One undo removes the whole graph.
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-connector-id]')).toHaveCount(0);

  await page.getByTestId('tool-graph').click();
  await page.getByTestId('graph-new').click();
  await page.getByTestId('graph-tab-edges').click();
  await page.getByTestId('graph-edges').fill('A-A');
  await page.getByTestId('graph-create').click();
  await expect(page.getByTestId('graph-errors')).toContainText('Line 1: A-A is a self-loop');
  await page.getByTestId('graph-edges').fill('A-B:2, B-C:3, A-C:10');
  await page.getByTestId('graph-create').click();
  await expect(page.getByTestId('connector-label')).toHaveCount(3);

  await page.getByTestId('tool-graph').click();
  await page.getByTestId('graph-algorithms').click();
  await page.mouse.click(900, 600);
  await page.getByTestId('algo-kind').selectOption('path');
  await page.getByTestId('algo-start').selectOption({ label: 'A' });
  await page.getByTestId('algo-end').selectOption({ label: 'C' });
  await page.getByTestId('algo-run').click();
  await expect(page.getByTestId('algo-result')).toHaveText('A → B → C · cost 5');
  await expect(page.getByTestId('graph-highlight-edge')).toHaveCount(2);
  // Results are local: the other user sees no overlay.
  await expect(pb.getByTestId('graph-highlight-edge')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('graph-highlight-edge')).toHaveCount(0);

  await page.getByTestId('algo-kind').selectOption('bfs');
  await page.getByTestId('algo-run').click();
  await expect(page.getByTestId('graph-order-badge')).toHaveCount(3);
  await other.close();
});

test('edit a connector label by double-click; viewers cannot', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await page.keyboard.press('g');
  await page.getByTestId('graph-new').click();
  await page.getByTestId('graph-tab-edges').click();
  await page.getByTestId('graph-edges').fill('A-B');
  await page.getByTestId('graph-create').click();
  const edge = page.locator('[data-connector-id] polyline').last();
  const box = await edge.boundingBox();
  if (!box) throw new Error('edge not rendered');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId('connector-label-input').fill('42');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('connector-label')).toHaveText('42');

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  await expect(viewer.getByTestId('connector-label')).toHaveText('42');
  const vbox = await viewer.locator('[data-connector-id] polyline').last().boundingBox();
  if (!vbox) throw new Error('edge not rendered for viewer');
  await viewer.mouse.dblclick(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
  await expect(viewer.getByTestId('connector-label-input')).toHaveCount(0);
  await viewer.keyboard.press('g');
  await expect(viewer.getByTestId('graph-new')).toBeDisabled();
  await viewer.getByTestId('graph-algorithms').click();
  await expect(viewer.getByTestId('algorithms-panel')).toBeVisible();
  await viewerCtx.close();
});
