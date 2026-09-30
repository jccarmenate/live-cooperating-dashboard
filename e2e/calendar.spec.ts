import { readFileSync } from 'node:fs';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

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

async function addCalendar(page: Page) {
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-calendar').click();
  await expect(page.getByTestId('calendar-page')).toBeVisible();
}

async function userIn(browser: Browser, timezoneId: string, path: string) {
  const ctx = await browser.newContext({ timezoneId });
  const page = await ctx.newPage();
  await openBoard(page, path);
  return { ctx, page };
}

/** Creates an event through the editor (today, unless the editor already has another date). */
async function newEvent(
  page: Page,
  title: string,
  opts: { start?: string; end?: string; weekly?: boolean } = {},
) {
  await page.getByTestId('cal-new').click();
  await page.getByTestId('cal-title-input').fill(title);
  if (opts.start) {
    await page.getByTestId('cal-allday').uncheck();
    await page.getByTestId('cal-start-time').fill(opts.start);
    await page.getByTestId('cal-end-time').fill(opts.end ?? opts.start);
  }
  if (opts.weekly) await page.getByTestId('cal-repeat').selectOption('weekly');
  await page.getByTestId('cal-save').click();
  await expect(page.getByTestId('cal-editor')).toHaveCount(0);
}

test('two users in different time zones see one event at their own local times', async ({
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const madrid = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${editKey}`);
  await addCalendar(madrid.page);
  const havana = await userIn(
    browser,
    'America/Havana',
    madrid.page.url().replace(/^.*\/r\//, '/r/'),
  );
  await expect(havana.page.getByTestId('calendar-page')).toBeVisible();
  await expect(madrid.page.getByTestId('cal-zone')).toHaveText('Times in Europe/Madrid');
  await expect(havana.page.getByTestId('cal-zone')).toHaveText('Times in America/Havana');

  // Madrid uses the week view; Havana stays on the month grid, which also covers the
  // neighbouring days, so the test holds even when the two zones are on different dates.
  await madrid.page.getByTestId('cal-view-week').click();
  await newEvent(madrid.page, 'Standup', { start: '09:00', end: '10:00' });

  const mine = madrid.page.getByTestId('cal-event').filter({ hasText: 'Standup' });
  await expect(mine).toContainText('09:00');
  const theirs = havana.page.getByTestId('cal-event').filter({ hasText: 'Standup' });
  await expect(theirs).toHaveCount(1);
  await expect(theirs).not.toContainText('09:00');
  await theirs.dblclick();
  await expect(havana.page.getByTestId('cal-event-zone')).toContainText(
    '09:00–10:00 Europe/Madrid',
  );
  await madrid.ctx.close();
  await havana.ctx.close();
});

test('a weekly event: delete one occurrence only, and answer RSVP live', async ({
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const a = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${editKey}`);
  await addCalendar(a.page);
  const b = await userIn(browser, 'Europe/Madrid', a.page.url().replace(/^.*\/r\//, '/r/'));
  await newEvent(a.page, 'Retro', { weekly: true });
  // Next month's grid lies entirely after today, so it always shows 6 occurrences.
  await a.page.getByTestId('cal-next').click();
  await b.page.getByTestId('cal-next').click();

  const series = a.page.getByTestId('cal-event').filter({ hasText: 'Retro' });
  await expect(series).toHaveCount(6);
  const before = 6;
  await series.nth(1).click();
  await a.page.keyboard.press('Delete');
  await expect(a.page.getByTestId('cal-series')).toBeVisible();
  await a.page.getByTestId('cal-series-one').click();
  await expect(series).toHaveCount(before - 1);
  await expect(b.page.getByTestId('cal-event').filter({ hasText: 'Retro' })).toHaveCount(
    before - 1,
  );

  await b.page.getByTestId('cal-event').filter({ hasText: 'Retro' }).first().dblclick();
  await a.page.getByTestId('cal-event').filter({ hasText: 'Retro' }).first().dblclick();
  await expect(b.page.getByTestId('cal-event-dots').first()).toBeVisible();
  await a.page.getByTestId('cal-rsvp-yes').click();
  await expect(b.page.getByTestId('cal-rsvp-summary')).toHaveText(
    '1 going · 0 maybe · 0 not going',
  );

  // A changed repeat rule applies to the whole series only: the question offers no
  // "Only this event", and cancelling it leaves the editor open.
  await a.page.getByTestId('cal-interval').fill('2');
  await a.page.getByTestId('cal-save').click();
  await expect(a.page.getByTestId('cal-series')).toBeVisible();
  await expect(a.page.getByTestId('cal-series-all')).toBeVisible();
  await expect(a.page.getByTestId('cal-series-one')).toHaveCount(0);
  await a.page.getByTestId('cal-series-cancel').click();
  await expect(a.page.getByTestId('cal-series')).toHaveCount(0);
  await expect(a.page.getByTestId('cal-editor')).toBeVisible();

  // Escape with the question on top of the editor closes only the question.
  await a.page.getByTestId('cal-save').click();
  await expect(a.page.getByTestId('cal-series')).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(a.page.getByTestId('cal-series')).toHaveCount(0);
  await expect(a.page.getByTestId('cal-editor')).toBeVisible();
  await expect(a.page.getByTestId('cal-interval')).toHaveValue('2');

  // Neither the cancel nor the Escape changed the series.
  await a.page.getByTestId('cal-cancel').click();
  await expect(a.page.getByTestId('cal-editor')).toHaveCount(0);
  await expect(series).toHaveCount(before - 1);
  await expect(b.page.getByTestId('cal-event').filter({ hasText: 'Retro' })).toHaveCount(
    before - 1,
  );
  await a.ctx.close();
  await b.ctx.close();
});

test('a viewer reads events but cannot change them; export stays available', async ({
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  const editor = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${editKey}`);
  await addCalendar(editor.page);
  await newEvent(editor.page, 'Planning');
  const pageId = new URL(editor.page.url()).hash.match(/p=([^&]+)/)?.[1] ?? '';
  const viewer = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${viewKey}&p=${pageId}`);
  await expect(viewer.page.getByTestId('calendar-page')).toBeVisible();
  await expect(viewer.page.getByTestId('cal-new')).toHaveCount(0);
  await viewer.page.getByTestId('cal-event').filter({ hasText: 'Planning' }).dblclick();
  await expect(viewer.page.getByTestId('cal-save')).toHaveCount(0);
  await expect(viewer.page.getByTestId('cal-rsvp-yes')).toHaveCount(0);
  await expect(viewer.page.getByTestId('cal-title-input')).toBeDisabled();
  await viewer.page.getByTestId('cal-cancel').click();
  await viewer.page.getByTestId('cal-menu').click();
  await expect(viewer.page.getByTestId('cal-export')).toBeVisible();
  await expect(viewer.page.getByTestId('cal-import')).toHaveCount(0);
  await editor.ctx.close();
  await viewer.ctx.close();
});

test('sticky → calendar → open on board, then export and re-import the calendar', async ({
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const { ctx, page } = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${editKey}`);
  await page.keyboard.press('s');
  await page.mouse.click(500, 350);
  await page.keyboard.type('Plan the retro');
  await page.keyboard.press('Escape');
  await page.mouse.click(500, 350, { button: 'right' });
  await page.getByTestId('menu-add-calendar').click();
  await expect(page.getByTestId('add-cal-title')).toHaveValue('Plan the retro');
  await page.getByTestId('add-cal-submit').click();
  await expect(page.getByText(/Added to Calendar/)).toBeVisible();

  await page.getByRole('tab', { name: /Calendar/ }).click();
  const ev = page.getByTestId('cal-event').filter({ hasText: 'Plan the retro' });
  await ev.dblclick();
  await page.getByTestId('cal-open-board').click();
  await expect(page.getByTestId('selection-outline')).toHaveCount(1);

  await page.getByRole('tab', { name: /Calendar/ }).click();
  await page.getByTestId('cal-menu').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('cal-export').click(),
  ]);
  const file = await download.path();
  expect(readFileSync(file, 'utf8')).toContain('SUMMARY:Plan the retro');

  await addCalendar(page);
  await page.getByTestId('cal-menu').click();
  await page.getByTestId('cal-import-input').setInputFiles(file);
  await expect(page.getByTestId('cal-import-summary')).toContainText('Imported 1 event');
  await ctx.close();
});

test('the mouse wheel scrolls the calendar a week at a time', async ({ page, request }) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await addCalendar(page);

  // Month view: each notch rolls the 6-week grid by one row; the title follows its third row.
  const firstCell = page.getByTestId('cal-day').first();
  const start = (await firstCell.getAttribute('data-date')) as string;
  const plusDays = (date: string, n: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };
  const box = await page.getByTestId('cal-day').nth(15).boundingBox();
  await page.mouse.move((box?.x ?? 0) + 30, (box?.y ?? 0) + 30);
  await page.mouse.wheel(0, 100);
  await expect(firstCell).toHaveAttribute(
    'data-date',
    plusDays(start, 7).toISOString().slice(0, 10),
  );
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 100);
  await expect(firstCell).toHaveAttribute(
    'data-date',
    plusDays(start, 35).toISOString().slice(0, 10),
  );
  const focus = plusDays(start, 35 + 17);
  const month = focus.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  await expect(page.getByTestId('cal-title')).toHaveText(`${month} ${focus.getUTCFullYear()}`);
  await page.mouse.wheel(0, -100);
  await expect(firstCell).toHaveAttribute(
    'data-date',
    plusDays(start, 28).toISOString().slice(0, 10),
  );

  // Week view: the wheel changes the week; Shift+wheel scrolls the hours instead.
  await page.getByTestId('cal-today').click();
  await page.getByTestId('cal-view-week').click();
  const title = page.getByTestId('cal-title');
  const thisWeek = (await title.textContent()) as string;
  const grid = page.locator('[data-week-scroller]');
  const g = await grid.boundingBox();
  await page.mouse.move((g?.x ?? 0) + (g?.width ?? 0) / 2, (g?.y ?? 0) + 150);
  await page.mouse.wheel(0, 100);
  await expect(title).not.toHaveText(thisWeek);
  await page.mouse.wheel(0, -100);
  await expect(title).toHaveText(thisWeek);
  const top = await grid.evaluate((el) => el.scrollTop);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Shift');
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(top);
  await expect(title).toHaveText(thisWeek);
});
