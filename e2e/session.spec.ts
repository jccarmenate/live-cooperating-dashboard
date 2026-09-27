import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function newRoom(request: APIRequestContext) {
  const res = await request.post(`${SYNC}/api/rooms`);
  return (await res.json()) as { roomId: string; editKey: string; viewKey: string };
}

async function sticky(page: Page, x: number, y: number, text: string) {
  await page.keyboard.press('s');
  await page.mouse.click(x, y);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test('two users vote with a shared countdown, capped at three votes, and results survive the end', async ({
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

  await sticky(page, 300, 300, 'One');
  await sticky(page, 520, 300, 'Two');

  await page.getByTestId('vote-start').click();
  await page.getByTestId('vote-3m').click();
  await expect(page.getByTestId('vote-status')).toContainText('VOTE OPEN · 2:5');
  await expect(pb.getByTestId('vote-status')).toContainText('3 left');

  const badges = pb.getByTestId('vote-badge');
  await expect(badges).toHaveCount(2);
  await badges.nth(0).click();
  await badges.nth(1).click();
  await expect(pb.getByTestId('vote-status')).toContainText('1 left');
  await expect(page.getByTestId('vote-badge').nth(0)).toContainText('● 1');
  await badges.nth(0).click();
  await expect(page.getByTestId('vote-badge').nth(0)).toContainText('● 0');
  await expect(pb.getByTestId('vote-badge').nth(0)).toHaveAttribute('data-mine', 'false');

  // Voting does not select or drag the sticky.
  await expect(pb.getByTestId('selection-outline')).toHaveCount(0);

  await page.getByTestId('vote-end').click();
  await expect(pb.getByTestId('vote-status')).toHaveText('VOTE ENDED');
  await expect(pb.getByTestId('vote-badge')).toHaveCount(1);
  await expect(pb.getByTestId('vote-badge')).toContainText('● 1');
  await other.close();
});

test('a comment thread is created, answered, resolved and reopened across users', async ({
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

  await sticky(page, 400, 300, 'Ship it');
  await page.keyboard.press('m');
  await page.mouse.click(420, 280);
  await page.getByTestId('comment-composer').fill('Needs a test');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('comment-thread')).toContainText('Needs a test');
  // Close A's popover (an open thread stays visible even once resolved): select tool, click empty canvas.
  await page.keyboard.press('v');
  await page.mouse.click(900, 600);
  await expect(page.getByTestId('comment-thread')).toHaveCount(0);

  await expect(pb.getByTestId('comment-pin')).toHaveCount(1);
  await pb.getByTestId('comment-pin').click();
  await pb.getByTestId('comment-reply').fill('On it');
  await pb.keyboard.press('Enter');
  await expect(page.getByTestId('comment-pin')).toContainText('2');
  await expect(page.getByTestId('comments-toggle')).toHaveText('Comments · 1');

  await pb.getByTestId('comment-resolve').click();
  await expect(page.getByTestId('comment-pin')).toHaveCount(0);
  await expect(page.getByTestId('comments-toggle')).toHaveText('Comments · 0');

  await page.getByTestId('comments-toggle').click();
  await page.getByTestId('comments-tab-resolved').click();
  await expect(page.getByTestId('comment-item')).toContainText('Needs a test');
  await page.getByTestId('comment-item').click();
  await expect(page.getByTestId('comment-resolve')).toHaveText('Reopen');
  await page.getByTestId('comment-resolve').click();
  await expect(pb.getByTestId('comment-pin')).toHaveCount(1);
  await other.close();
});

test('a read-only link sees votes and comments but cannot vote or comment', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await sticky(page, 400, 300, 'Hello');
  await page.keyboard.press('m');
  await page.mouse.click(420, 280);
  await page.getByTestId('comment-composer').fill('Visible to viewers');
  await page.keyboard.press('Enter');
  await page.getByTestId('vote-start').click();
  await page.getByTestId('vote-1m').click();

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  await expect(viewer.getByTestId('vote-status')).toContainText('VOTE OPEN');
  await expect(viewer.getByTestId('vote-start')).toHaveCount(0);
  await expect(viewer.getByTestId('tool-comment')).toHaveCount(0);
  await viewer.getByTestId('vote-badge').click();
  await expect(page.getByTestId('vote-badge')).toContainText('● 0');
  await viewer.getByTestId('comment-pin').click();
  await expect(viewer.getByTestId('comment-thread')).toContainText('Visible to viewers');
  await expect(viewer.getByTestId('comment-reply')).toHaveCount(0);
  await viewerCtx.close();
});
