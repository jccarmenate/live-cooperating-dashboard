// A scripted collaborator for live demos. Opens a board in a real Chromium
// window and keeps working in it until you close the window or press Ctrl+C.
//
//   node scripts/demo-bot.mjs [--role writer|mover] [--x 40 --y 40] [--channel chrome|msedge]
//                             [--headless] [board-url]
//
// writer: writes a sprint-retro board (stickies, a flow, a heading).
// mover:  tidies up — drags shapes around and "+1"s stickies.
// Without a board URL a new room is created and its link printed.

import { chromium } from '@playwright/test';
import { createActor, createRoom, sleep } from './lib/actor.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const role = flag('role', 'writer');
const winX = Number(flag('x', '40'));
const winY = Number(flag('y', '40'));
const headless = args.includes('--headless');
const url = args.find((a) => a.startsWith('http')) ?? (await createRoom());

console.log(`[${role}] board: ${url}`);

// Visible windows prefer the installed Chrome (some Windows setups block the
// bundled Chromium binary); fall back to the bundled one if it isn't there.
const channel = flag('channel', headless ? undefined : 'chrome');
const launch = (extra) =>
  chromium.launch({
    headless,
    args: [`--window-size=760,680`, `--window-position=${winX},${winY}`],
    ...extra,
  });
const browser = await (channel ? launch({ channel }).catch(() => launch({})) : launch({}));
const page = await browser.newPage({ viewport: { width: 740, height: 560 } });
const actor = createActor(page);
await actor.open(url);

let stopped = false;
const stop = async () => {
  stopped = true;
  await browser.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
browser.on('disconnected', () => process.exit(0));

const WENT_WELL = [
  'Shipped offline mode 2 days early',
  'Pairing on the sync engine paid off',
  'Zero rollbacks this sprint',
];
const TO_IMPROVE = ['Too many hops in PR review', 'Flaky e2e suite on CI, again'];
const ACTIONS = ['Cap PR reviewers at two', 'Quarantine flaky tests by Friday'];

async function writer() {
  await actor.heading(0.4, 0.07, 'Sprint 14 retro');
  await actor.sticky(0.2, 0.3, WENT_WELL[0]);
  await actor.sticky(0.2, 0.62, WENT_WELL[1]);
  await actor.sticky(0.5, 0.3, TO_IMPROVE[0]);
  await actor.sticky(0.5, 0.62, TO_IMPROVE[1]);
  await actor.rect(0.68, 0.18, 0.92, 0.32, 'Intake');
  await actor.rect(0.68, 0.42, 0.92, 0.56, 'Build');
  await actor.sticky(0.8, 0.78, ACTIONS[0]);
  await actor.heading(0.42, 0.93, 'Who owns the release notes?');
  // Afterwards keep the cursor alive and add the occasional note.
  let i = 0;
  while (!stopped) {
    await actor.wander(0.15 + Math.random() * 0.7, 0.15 + Math.random() * 0.7);
    await sleep(1500);
    if (i % 6 === 5 && (await actor.shapeCount()) < 16) {
      const pool = [...WENT_WELL, ...ACTIONS];
      await actor.sticky(
        0.2 + Math.random() * 0.6,
        0.2 + Math.random() * 0.6,
        pool[i % pool.length],
      );
    }
    i++;
  }
}

async function mover() {
  let i = 0;
  while (!stopped) {
    await actor.wander(0.2 + Math.random() * 0.6, 0.2 + Math.random() * 0.6);
    await sleep(1200);
    const count = await actor.shapeCount();
    if (count > 0) {
      if (i % 3 === 2) {
        await actor.appendText(i, ' +1');
      } else {
        const dx = (Math.random() - 0.5) * 0.25;
        const dy = (Math.random() - 0.5) * 0.25;
        await actor.dragShape(i, dx, dy);
      }
    }
    await sleep(1800);
    i++;
  }
}

try {
  await (role === 'mover' ? mover() : writer());
} catch (err) {
  if (!stopped) {
    console.error(`[${role}]`, err);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}
