import { expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

test('two users collaborate live in a new board', async ({ browser, request }) => {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;

  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await openBoard(pa, path);
  await openBoard(pb, path);

  await expect(pa.getByTestId('online-count')).toHaveText('2 online');
  await expect(pb.getByTestId('online-count')).toHaveText('2 online');

  // A creates a sticky and types into it; B sees it.
  await pa.getByTestId('tool-sticky').click();
  await pa.getByTestId('canvas').click({ position: { x: 500, y: 300 } });
  await pa.getByTestId('text-editor').fill('Hello from A');
  await pa.keyboard.press('Escape');
  await expect(pb.getByText('Hello from A')).toBeVisible();

  // B sees A's named cursor.
  await pa.mouse.move(700, 450);
  await pa.mouse.move(720, 460);
  await expect(pb.getByTestId('remote-cursor').first()).toBeVisible();

  // A late joiner receives the persisted state.
  const c = await browser.newContext();
  const pc = await c.newPage();
  await openBoard(pc, path);
  await expect(pc.getByText('Hello from A')).toBeVisible();

  await Promise.all([a.close(), b.close(), c.close()]);
});

test('an invalid key is rejected', async ({ page }) => {
  await page.goto('/r/doesnotexist#k=bogus');
  await expect(page.getByText('This link is invalid')).toBeVisible({ timeout: 20_000 });
});
