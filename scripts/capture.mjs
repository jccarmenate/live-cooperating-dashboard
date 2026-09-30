// Regenerates the README media from the running dev servers:
//   docs/screenshots/landing.png, docs/screenshots/collab.png, docs/demo.gif
// Two independent browser contexts (two anonymous users, one in Madrid and one in Havana)
// tour one room at the same time: a retro board, a spreadsheet, a graph and a calendar.
// Their recordings are stitched side by side with ffmpeg.
//
//   npm run dev            # in another terminal
//   node scripts/capture.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createActor, createRoom, sleep, WEB } from './lib/actor.mjs';

const OUT = 'docs/screenshots';
const WORK = 'test-results/capture';
// Large enough that the properties bar never covers the toolbar; board steps stay clear of
// the minimap (bottom right) and the zoom controls (bottom left).
const size = { width: 800, height: 560 };

rmSync(WORK, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

const landing = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await landing.goto(WEB);
await landing.screenshot({ path: join(OUT, 'landing.png') });
await landing.close();

const url = await createRoom();
const context = (dir, timezoneId) =>
  browser.newContext({
    viewport: size,
    timezoneId,
    locale: 'en-GB',
    recordVideo: { dir: join(WORK, dir), size },
  });
const ctxA = await context('a', 'Europe/Madrid');
const ctxB = await context('b', 'America/Havana');
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();
const a = createActor(pageA);
const b = createActor(pageB);
await Promise.all([a.open(url), b.open(url)]);

const shotA = join(WORK, 'a.png');
const shotB = join(WORK, 'b.png');
/** Waits until a text shows up in a test id on a page (a peer's edit has arrived). */
const seen = (page, testId, text) =>
  page.getByTestId(testId).filter({ hasText: text }).first().waitFor({ timeout: 15_000 });
/** B follows A to the n-th page tab once it has synced. */
const follow = async (n, ready) => {
  await pageB.getByTestId('page-tab').nth(n).waitFor();
  await sleep(500);
  await b.openTab(n, ready);
};

try {
  // 1. A retro board: both users write at once, with live cursors.
  await Promise.all([
    (async () => {
      await a.heading(0.36, 0.08, 'Sprint 14 retro');
      await a.sticky(0.2, 0.32, 'Shipped offline mode 2 days early');
      await a.sticky(0.2, 0.64, 'Too many hops in PR review');
      await a.wander(0.45, 0.45);
    })(),
    (async () => {
      await b.wander(0.62, 0.2);
      await sleep(900);
      await b.sticky(0.5, 0.36, 'Cap PR reviewers at two');
      await sleep(900);
      await b.dragShape(1, 0.06, 0.04);
      await b.wander(0.35, 0.5);
    })(),
  ]);
  await b.appendText(2, ' +1');
  // Deselect, so the properties bar does not cover the board in the screenshot.
  await Promise.all([a.deselect(0.82, 0.18), b.deselect(0.8, 0.22)]);
  await sleep(700);
  await pageA.screenshot({ path: shotA });
  await pageB.screenshot({ path: shotB });
  await sleep(600);

  // 2. A spreadsheet: A writes a total; B changes a number and A's total follows.
  await a.addPage('sheet');
  await follow(1, 'sheet-page');
  await a.fillColumn('A1', ['12', '30', '18', '=SUM(A1:A3)']);
  await seen(pageB, 'cell-A4', '60');
  await sleep(600);
  await b.fillColumn('A2', ['45']);
  await seen(pageA, 'cell-A4', '75');
  await sleep(1200);

  // 3. A graph from an edge list, and a shortest path (the highlight is A's alone).
  await a.addPage('board');
  await follow(2, 'canvas');
  await Promise.all([
    a.graphFromEdges('A-B:2, B-C:3, A-C:10'),
    (async () => {
      await b.wander(0.62, 0.3);
      await sleep(1500);
      await b.wander(0.45, 0.55);
    })(),
  ]);
  await a.shortestPath('A', 'C');
  await b.wander(0.55, 0.45);
  await sleep(1500);

  // 4. A calendar: A (Madrid) drags a weekly 09:00 standup; B (Havana) sees it at 03:00
  // and answers Going, which A sees live.
  await a.addPage('calendar');
  await pageA.getByTestId('cal-view-week').click();
  await follow(3, 'calendar-page');
  await a.dragEvent(2, 9, 10, 'Standup', { weekly: true });
  await seen(pageB, 'cal-event', '03:00');
  await sleep(900);
  await b.rsvpGoing('Standup');
  await pageA.getByTestId('cal-event').filter({ hasText: 'Standup' }).first().dblclick();
  await seen(pageA, 'cal-rsvp-summary', '1 going');
  // The editor is taller than the window: bring the answers into view.
  await pageA.getByTestId('cal-rsvp').scrollIntoViewIfNeeded();
  await sleep(2500);
} catch (err) {
  await pageA.screenshot({ path: join(WORK, 'fail-a.png') }).catch(() => {});
  await pageB.screenshot({ path: join(WORK, 'fail-b.png') }).catch(() => {});
  throw err;
}

const videoA = await pageA.video()?.path();
const videoB = await pageB.video()?.path();
await ctxA.close();
await ctxB.close();
await browser.close();
if (!videoA || !videoB) throw new Error('video recording missing');

// A thin black divider between the two users' windows.
const sideBySide = '[0:v]pad=iw+6:ih:0:0:black[l];[l][1:v]hstack=inputs=2';

execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-i',
  shotA,
  '-i',
  shotB,
  '-filter_complex',
  sideBySide,
  join(OUT, 'collab.png'),
]);

execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-ss',
  '1.2',
  '-i',
  videoA,
  '-ss',
  '1.2',
  '-i',
  videoB,
  '-filter_complex',
  `${sideBySide},fps=10,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
  'docs/demo.gif',
]);

const mb = (statSync('docs/demo.gif').size / 1024 / 1024).toFixed(1);
console.log(`room: ${url}`);
console.log(
  `wrote docs/screenshots/landing.png, docs/screenshots/collab.png, docs/demo.gif (${mb} MB)`,
);
