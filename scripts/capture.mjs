// Regenerates the README media from the running dev servers:
//   docs/screenshots/landing.png, docs/screenshots/collab.png, docs/demo.gif
// Two independent browser contexts (two anonymous users) work on one board at
// the same time; their recordings are stitched side by side with ffmpeg.
//
//   npm run dev            # in another terminal
//   node scripts/capture.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createActor, createRoom, sleep, WEB } from './lib/actor.mjs';

const OUT = 'docs/screenshots';
const WORK = 'test-results/capture';
const size = { width: 640, height: 480 };

rmSync(WORK, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

const landing = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await landing.goto(WEB);
await landing.screenshot({ path: join(OUT, 'landing.png') });
await landing.close();

const url = await createRoom();
const ctxA = await browser.newContext({
  viewport: size,
  recordVideo: { dir: join(WORK, 'a'), size },
});
const ctxB = await browser.newContext({
  viewport: size,
  recordVideo: { dir: join(WORK, 'b'), size },
});
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();
const a = createActor(pageA);
const b = createActor(pageB);
await Promise.all([a.open(url), b.open(url)]);

const failShots = async (err) => {
  await pageA.screenshot({ path: join(WORK, 'fail-a.png') }).catch(() => {});
  await pageB.screenshot({ path: join(WORK, 'fail-b.png') }).catch(() => {});
  throw err;
};

await Promise.all([
  (async () => {
    await a.heading(0.42, 0.07, 'Sprint 14 retro');
    await a.sticky(0.24, 0.34, 'Shipped offline mode 2 days early');
    await a.sticky(0.24, 0.74, 'Too many hops in PR review');
    await a.rect(0.6, 0.62, 0.92, 0.8, 'Ship v2.4');
    await a.wander(0.45, 0.5);
  })(),
  (async () => {
    await b.wander(0.8, 0.2);
    await sleep(900);
    await b.sticky(0.66, 0.32, 'Cap PR reviewers at two');
    await sleep(1200);
    await b.dragShape(1, 0.1, 0.03);
    await b.wander(0.42, 0.45);
  })(),
]).catch(failShots);
await Promise.all([a.appendText(2, ' +1'), b.wander(0.3, 0.62)]);
await sleep(700);

const shotA = join(WORK, 'a.png');
const shotB = join(WORK, 'b.png');
await pageA.screenshot({ path: shotA });
await pageB.screenshot({ path: shotB });
await sleep(1000);

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
  `${sideBySide},fps=12,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
  'docs/demo.gif',
]);

console.log(`board: ${url}`);
console.log('wrote docs/screenshots/landing.png, docs/screenshots/collab.png, docs/demo.gif');
