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

test('pages are created, used, renamed, reordered and deleted across users', async ({
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

  const tabs = page.getByTestId('page-tab');
  await expect(tabs).toHaveCount(1);
  await page.getByTestId('page-add').click();
  await expect(page.getByTestId('page-add-sheet')).toBeDisabled();
  await page.getByTestId('page-add-board').click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/&p=/);

  // Draw on the new page; the first page stays empty.
  await page.keyboard.press('s');
  await page.mouse.click(400, 350);
  await page.keyboard.type('Only on page two');
  await page.keyboard.press('Escape');
  await tabs.nth(0).click();
  await expect(page.getByText('Only on page two')).toHaveCount(0);

  // B sees the new tab and its content, and A's presence dot moves with A.
  const tabsB = pb.getByTestId('page-tab');
  await expect(tabsB).toHaveCount(2);
  await tabsB.nth(1).click();
  await expect(pb.getByText('Only on page two')).toBeVisible();
  await expect(page.getByTestId('page-tab').nth(1).getByTestId('page-peer-dot')).toHaveCount(1);

  // Rename by double-click.
  await tabs.nth(1).dblclick();
  await page.getByTestId('page-rename-input').fill('Ideas');
  await page.keyboard.press('Enter');
  await expect(tabsB.nth(1)).toHaveText(/Ideas/);

  // Reorder by dragging Ideas before the first tab.
  await tabs.nth(1).dragTo(tabs.nth(0));
  await expect(tabsB.nth(0)).toHaveText(/Ideas/);

  // Delete through the context menu, with confirmation; B falls back to the remaining page.
  await tabs.nth(0).click({ button: 'right' });
  await page.getByTestId('page-menu-delete').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Page deleted');
  await expect(tabsB).toHaveCount(1);
  await expect(pb.getByText('Only on page two')).toHaveCount(0);
  await other.close();
});

test('share dialog gives edit and read-only links; the title is editable', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);

  await page.getByTestId('board-title').click();
  await page.getByTestId('board-title-input').fill('Sprint 14 Retro');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('board-title')).toHaveText('Sprint 14 Retro');

  await page.getByTestId('share-open').click();
  await expect(page.getByTestId('share-edit-link')).toHaveValue(
    new RegExp(`/r/${roomId}#k=${editKey}&p=`),
  );
  await expect(page.getByTestId('share-view-link')).toHaveValue(new RegExp(`#k=${viewKey}&p=`));
  const viewLink = await page.getByTestId('share-view-link').inputValue();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog')).toHaveCount(0);

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, viewLink.replace(/^https?:\/\/[^/]+/, ''));
  await expect(viewer.getByTestId('board-title')).toHaveText('Sprint 14 Retro');
  await expect(viewer.getByTestId('page-add')).toHaveCount(0);
  await expect(viewer.getByTestId('tool-comment')).toHaveCount(0);
  await viewer.getByTestId('share-open').click();
  await expect(viewer.getByTestId('share-edit-link')).toHaveCount(0);
  await expect(viewer.getByTestId('share-view-link')).toHaveValue(new RegExp(`#k=${viewKey}`));
  await viewerCtx.close();
});

test('clicking the canvas commits and blurs the title; board keys work again', async ({
  page,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);

  await page.getByTestId('board-title').click();
  await page.getByTestId('board-title-input').fill('Renamed');
  await page.mouse.click(700, 500);
  await expect(page.getByTestId('board-title')).toHaveText('Renamed');

  // The key must reach the board, not a still-focused title input.
  await page.keyboard.press('r');
  await expect(page.getByTestId('tool-rect')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('board-title')).toHaveText('Renamed');
});

test('a hash link to a missing page keeps the user put and corrects the URL', async ({
  page,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  const tabs = page.getByTestId('page-tab');
  const selected = page.locator('[data-testid="page-tab"][aria-selected="true"]');
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-board').click();
  await expect(tabs).toHaveCount(2);
  await tabs.nth(0).click();
  await expect(selected).toHaveText(/^Board$/);
  const url = page.url();

  await page.evaluate((k) => {
    window.location.hash = `#k=${k}&p=nonexistent`;
  }, editKey);
  await expect(page).toHaveURL(url);
  await expect(selected).toHaveText(/^Board$/);

  // The fallback is pinned: moving another page first does not move the user.
  await tabs.nth(1).dragTo(tabs.nth(0));
  await expect(tabs.nth(0)).toHaveText(/Board 2/);
  await expect(selected).toHaveText(/^Board$/);
  await expect(page).toHaveURL(url);
});
