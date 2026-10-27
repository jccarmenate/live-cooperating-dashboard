import { expect, type Page, test, type WebSocketRoute } from '@playwright/test';
import { connectFiller } from './helpers/filler';

const SYNC = 'http://localhost:8787';

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function addSheet(page: Page) {
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-sheet').click();
  await expect(page.getByTestId('sheet-page')).toBeVisible();
}

async function addCalendar(page: Page) {
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-calendar').click();
  await expect(page.getByTestId('calendar-page')).toBeVisible();
}

/** Creates a sticky with `text` at a canvas position and leaves the editor. */
async function addSticky(page: Page, text: string, x: number, y: number) {
  await page.getByTestId('tool-sticky').click();
  await page.getByTestId('canvas').click({ position: { x, y } });
  await page.getByTestId('text-editor').fill(text);
  await page.getByTestId('canvas').click({ position: { x: 900, y: 560 } });
  await expect(page.getByTestId('text-editor')).toBeHidden();
}

test('a full board says so to everyone, still deletes, and edits again once it shrinks', async ({
  browser,
  request,
}) => {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await openBoard(pa, path);
  await openBoard(pb, path);

  await addSticky(pa, 'Keep me', 300, 250);
  await addSticky(pa, 'Drop me', 600, 250);
  await expect(pb.getByText('Drop me')).toBeVisible();

  const filler = await connectFiller(roomId, editKey);
  try {
    await filler.fill();

    // Both users are told, and neither can create.
    await expect(pa.getByTestId('board-full')).toBeVisible({ timeout: 15_000 });
    await expect(pb.getByTestId('board-full')).toBeVisible();
    await expect(pa.getByTestId('board-full')).toHaveText(
      'This board is full — delete something to keep editing',
    );
    await expect(pa.getByTestId('tool-sticky')).toHaveCount(0);
    await expect(pa.getByTestId('undo')).toHaveCount(0);

    // Deleting still works and reaches the other user.
    await pa.getByText('Drop me').click();
    await pa.keyboard.press('Delete');
    await expect(pa.getByText('Drop me')).toHaveCount(0);
    await expect(pb.getByText('Drop me')).toHaveCount(0);
    await expect(pb.getByText('Keep me')).toBeVisible();
    await expect(pa.getByTestId('status-notice')).toHaveCount(0);

    // Once the bulk is gone the server saves, measures under 900 KB and lets everyone edit again.
    await filler.empty();
    await expect(pa.getByTestId('board-full')).toHaveCount(0, { timeout: 20_000 });
    await expect(pb.getByTestId('board-full')).toHaveCount(0);
    await addSticky(pb, 'Back in business', 450, 450);
    await expect(pa.getByText('Back in business')).toBeVisible();
  } finally {
    filler.close();
    await a.close();
    await b.close();
  }
});

test('a user whose change was refused is asked to reload, and the reload restores the shared board', async ({
  browser,
  request,
}) => {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // The page's socket goes through this route, so the test can lose what the page sends
  // (a change made on a bad network) and then cut the connection.
  let losing = false;
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/parties\/room\//, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (!losing) server.send(message);
    });
  });

  await openBoard(page, path);
  await addSticky(page, 'Shared', 300, 250);

  const filler = await connectFiller(roomId, editKey);
  try {
    // This sticky never reaches the server; meanwhile the board fills up.
    losing = true;
    await addSticky(page, 'Never sent', 600, 250);
    await filler.fill();
    await expect(page.getByTestId('board-full')).toBeVisible({ timeout: 15_000 });

    // The connection drops and comes back: the reconnect offers the lost sticky, and the
    // full board refuses it.
    losing = false;
    await socket?.close({ code: 4000, reason: 'test cut' });
    const notice = page.getByTestId('status-notice');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText("Some changes couldn't be saved");
    // The full board refused them, not a message that was too large.
    await expect(notice).toContainText('The board was full when you made them.');
    await page.getByTestId('status-reload').click();

    await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
      timeout: 20_000,
    });
    await expect(page.getByText('Shared')).toBeVisible();
    await expect(page.getByText('Never sent')).toHaveCount(0);
    await expect(page.getByTestId('status-notice')).toHaveCount(0);
  } finally {
    filler.close();
    await ctx.close();
  }
});

test('a full sheet and a full calendar still let go of things', async ({ browser, request }) => {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await openBoard(pa, path);
  await openBoard(pb, path);

  // A sheet with a value and a calendar with an event, while the board still takes edits.
  await addSheet(pa);
  await pa.getByTestId('cell-A1').click();
  await pa.keyboard.type('Gone soon');
  await pa.keyboard.press('Enter');
  await addCalendar(pa);
  await pa.getByTestId('cal-new').click();
  await pa.getByTestId('cal-title-input').fill('Gone too');
  await pa.getByTestId('cal-save').click();
  await expect(pa.getByTestId('cal-event').filter({ hasText: 'Gone too' })).toHaveCount(1);

  // B follows the sheet and the calendar through their tabs.
  await pb.getByTestId('page-tab').nth(1).click();
  await expect(pb.getByTestId('cell-A1')).toHaveText('Gone soon');
  await pb.getByTestId('page-tab').nth(2).click();
  await expect(pb.getByTestId('cal-event').filter({ hasText: 'Gone too' })).toHaveCount(1);

  const filler = await connectFiller(roomId, editKey);
  try {
    await filler.fill();
    await expect(pa.getByTestId('board-full')).toBeVisible({ timeout: 15_000 });
    await expect(pb.getByTestId('board-full')).toBeVisible();

    // The calendar: select the event and press Delete.
    const event = (page: Page) => page.getByTestId('cal-event').filter({ hasText: 'Gone too' });
    await event(pa).click();
    await pa.keyboard.press('Delete');
    await expect(event(pa)).toHaveCount(0);
    await expect(event(pb)).toHaveCount(0);

    // The sheet: the menu of a cell offers what does not write, and Delete clears the value.
    await pa.getByTestId('page-tab').nth(1).click();
    await pa.getByTestId('cell-A1').click({ button: 'right' });
    await expect(pa.getByTestId('cell-menu-copy')).toBeVisible();
    await expect(pa.getByTestId('cell-menu-clear')).toBeVisible();
    await expect(pa.getByTestId('cell-menu-cut')).toHaveCount(0);
    await expect(pa.getByTestId('cell-menu-paste')).toHaveCount(0);
    await pa.keyboard.press('Escape');
    await expect(pa.getByTestId('cell-menu-copy')).toHaveCount(0);
    await pa.getByTestId('cell-A1').click();
    await pa.keyboard.press('Delete');
    await expect(pa.getByTestId('cell-A1')).toHaveText('');
    await pb.getByTestId('page-tab').nth(1).click();
    await expect(pb.getByTestId('cell-A1')).toHaveText('');

    // The server took both deletions: nobody was told that a change was refused.
    await expect(pa.getByTestId('status-notice')).toHaveCount(0);
    await expect(pb.getByTestId('status-notice')).toHaveCount(0);
  } finally {
    filler.close();
    await a.close();
    await b.close();
  }
});

test('a board with too many people says so, and Try again connects', async ({ page, request }) => {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };

  // While `crowded` is set the room is closed from the route with 4503 (too many people)
  // instead of being connected to the server. `sockets` counts the sockets the page opened.
  let crowded = true;
  let sockets = 0;
  await page.routeWebSocket(/\/parties\/room\//, (ws) => {
    sockets++;
    if (crowded) {
      ws.close({ code: 4503, reason: 'room full' });
      return;
    }
    ws.connectToServer();
  });

  await page.goto(`/r/${roomId}#k=${editKey}`);
  const notice = page.getByTestId('status-notice');
  await expect(notice).toContainText('This board has too many people right now');
  await expect(notice).toHaveAttribute('data-action', 'retry');
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'crowded');
  // The close is visible, not retried behind the notice: the provider would open a new socket
  // within a second or two, so wait longer than that and count.
  await page.waitForTimeout(3_000);
  expect(sockets).toBe(1);

  crowded = false;
  await page.getByTestId('status-retry').click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
  expect(sockets).toBe(2);
});
