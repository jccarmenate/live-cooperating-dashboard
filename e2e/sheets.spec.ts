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

async function addSheet(page: Page) {
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-sheet').click();
  await expect(page.getByTestId('sheet-page')).toBeVisible();
}

async function typeInto(page: Page, address: string, text: string) {
  await page.getByTestId(`cell-${address}`).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('two users edit a sheet; formulas follow inserted rows', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  await addSheet(page);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);
  await pb.getByTestId('page-tab').nth(1).click();
  await expect(pb.getByTestId('sheet-page')).toBeVisible();

  await typeInto(page, 'A1', '4');
  await typeInto(page, 'B1', '=A1*2+SUM(A1:A3)');
  await expect(pb.getByTestId('cell-B1')).toHaveText('12');
  await typeInto(pb, 'A2', '6');
  await expect(page.getByTestId('cell-B1')).toHaveText('18');

  // B sees where A is.
  await expect(pb.getByTestId('sheet-peer-range')).toHaveCount(1);

  // Insert a row above row 1: the formula moves down and still points at its cells.
  await page.getByTestId('row-header-1').click({ button: 'right' });
  await page.getByTestId('sheet-menu-insert-above').click();
  await expect(pb.getByTestId('cell-B2')).toHaveText('18');
  await page.getByTestId('cell-B2').click();
  await expect(page.getByTestId('formula-bar')).toHaveValue('=A2*2+SUM(A2:A4)');
  await expect(page.getByTestId('sheet-address')).toHaveText('B2');

  // Undo the insert.
  await page.getByTestId('cell-C5').click();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('cell-B1')).toHaveText('18');
  await other.close();
});

test('paste from a spreadsheet app, fill down, format and resize', async ({ page, request }) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await addSheet(page);

  await page.getByTestId('cell-A1').click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '1\t=A1*10\n2\t\n3\t\n');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.getByTestId('cell-B1')).toHaveText('10');

  await page.getByTestId('cell-B1').click();
  await page.getByTestId('cell-B3').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+d');
  await expect(page.getByTestId('cell-B3')).toHaveText('30');

  await page.getByTestId('cell-A1').click();
  await page.getByTestId('cell-A2').click({ modifiers: ['Shift'] });
  const handle = await page.getByTestId('fill-handle').boundingBox();
  const target = await page.getByTestId('cell-A5').boundingBox();
  if (!handle || !target) throw new Error('fill handle or A5 missing');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('cell-A5')).toHaveText('1');

  await page.getByTestId('cell-A1').click();
  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('cell-A1')).toHaveClass(/font-bold/);
  await expect(page.getByTestId('sheet-bold')).toHaveAttribute('aria-pressed', 'true');

  const before = await page.getByTestId('col-header-A').boundingBox();
  const grip = await page.getByTestId('col-resize-A').boundingBox();
  if (!before || !grip) throw new Error('header missing');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 80, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await page.getByTestId('col-header-A').boundingBox())?.width ?? 0)
    .toBeGreaterThan(before.width + 60);
});

test('errors, cycles and deleted references show their codes', async ({ page, request }) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await addSheet(page);
  await typeInto(page, 'A1', '=1/0');
  await expect(page.getByTestId('cell-A1')).toHaveText('#DIV/0!');
  await typeInto(page, 'B1', '=C1');
  await typeInto(page, 'C1', '=B1');
  await expect(page.getByTestId('cell-B1')).toHaveText('#CYCLE!');
  await typeInto(page, 'A3', '5');
  await typeInto(page, 'B4', '=A3+1');
  await expect(page.getByTestId('cell-B4')).toHaveText('6');
  await page.getByTestId('row-header-3').click();
  await page.getByTestId('row-header-3').click({ button: 'right' });
  await page.getByTestId('sheet-menu-delete-rows').click();
  await expect(page.getByTestId('cell-B3')).toHaveText('#REF!');
  await typeInto(page, 'D1', '=NOPE()');
  await expect(page.getByTestId('cell-D1')).toHaveText('#NAME?');
});

test('viewers can read and copy a sheet but not change it', async ({ page, browser, request }) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await addSheet(page);
  await typeInto(page, 'A1', 'read me');
  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  await viewer.getByTestId('page-tab').nth(1).click();
  await expect(viewer.getByTestId('cell-A1')).toHaveText('read me');
  await viewer.getByTestId('cell-A1').click();
  await viewer.keyboard.type('x');
  await expect(viewer.getByTestId('cell-editor')).toHaveCount(0);
  await expect(viewer.getByTestId('formula-bar')).toHaveAttribute('readonly', '');
  await expect(viewer.getByTestId('sheet-bold')).toHaveCount(0);
  const copied = await viewer.evaluate(() => {
    const data = new DataTransfer();
    document.dispatchEvent(
      new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }),
    );
    return data.getData('text/plain');
  });
  expect(copied).toBe('read me');
  await viewerCtx.close();
});

test('grid keys keep working after Select all, a page tab or a header', async ({
  page,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await addSheet(page);
  await typeInto(page, 'A1', 'one');
  await typeInto(page, 'B2', 'two');

  // The Select-all corner leaves the keyboard on the grid.
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('cell-A1')).toHaveText('');
  await expect(page.getByTestId('cell-B2')).toHaveText('');

  // So does switching to the sheet from its page tab.
  await page.getByTestId('page-tab').nth(0).click();
  await expect(page.getByTestId('sheet-page')).toHaveCount(0);
  await page.getByTestId('page-tab').nth(1).click();
  await expect(page.getByTestId('sheet-address')).toHaveText('A1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('7');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cell-A2')).toHaveText('7');

  // And pressing a column header.
  await page.getByTestId('col-header-A').click();
  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('cell-A1')).toHaveClass(/font-bold/);

  // AltGr (Ctrl+Alt on Windows) types its character: '@' starts an edit.
  await page.getByTestId('cell-C3').click();
  await page.evaluate(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '@',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByTestId('cell-editor')).toHaveValue('@');
});
