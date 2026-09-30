// Drives the real Relay UI with Playwright, the way a person would:
// toolbar clicks, pointer drags and typing. Used by the demo bot and the
// README capture script.

export const SYNC = process.env.RELAY_SYNC ?? 'http://localhost:8787';
export const WEB = process.env.RELAY_WEB ?? 'http://localhost:4000';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Creates a room on the sync server and returns its edit link. */
export async function createRoom() {
  const res = await fetch(`${SYNC}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/rooms failed: HTTP ${res.status}`);
  const { roomId, editKey } = await res.json();
  return `${WEB}/r/${roomId}#k=${encodeURIComponent(editKey)}`;
}

export function createActor(page) {
  let cursor = { x: 0, y: 0 };

  async function canvasBox() {
    const box = await page.getByTestId('canvas').boundingBox();
    if (!box) throw new Error('canvas not visible');
    return box;
  }

  /** Point at a fraction of the canvas (0..1 on each axis). */
  async function at(fx, fy) {
    const box = await canvasBox();
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
  }

  /** Moves the pointer along a slightly curved path so remote cursors look alive. */
  async function glide(to, steps = 18) {
    const from = cursor;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const bend = Math.sin(t * Math.PI) * 24;
      await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t - bend);
      await sleep(25);
    }
    cursor = to;
  }

  async function typeLikeAPerson(text) {
    for (const ch of text) {
      await page.keyboard.type(ch);
      await sleep(45 + Math.random() * 70);
    }
  }

  /** Rectangle, ellipse and line live in the toolbar's Shapes flyout. */
  const SHAPES = new Set(['rect', 'ellipse', 'line']);

  // In small windows the selection's floating properties bar can cover the toolbar, so the
  // buttons get a synthetic click instead of a pointer click at their position.
  const press = (testId) => page.getByTestId(testId).dispatchEvent('click');

  async function tool(id) {
    if (SHAPES.has(id)) await press('tool-shapes');
    await press(`tool-${id}`);
  }

  return {
    async open(url) {
      await page.goto(url);
      await page.waitForSelector('[data-testid=conn-status][data-status=online]', {
        timeout: 30_000,
      });
      cursor = await at(0.5, 0.5);
    },

    async wander(fx, fy) {
      await glide(await at(fx, fy));
    },

    async sticky(fx, fy, text) {
      await tool('sticky');
      const p = await at(fx, fy);
      await glide(p);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId('text-editor').waitFor();
      await typeLikeAPerson(text);
      await page.keyboard.press('Escape');
    },

    async heading(fx, fy, text) {
      await tool('text');
      const p = await at(fx, fy);
      await glide(p);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId('text-editor').waitFor();
      await typeLikeAPerson(text);
      await page.keyboard.press('Escape');
    },

    async rect(fx1, fy1, fx2, fy2, label) {
      await tool('rect');
      const a = await at(fx1, fy1);
      const b = await at(fx2, fy2);
      await glide(a);
      await page.mouse.down();
      cursor = a;
      await glide(b, 14);
      await page.mouse.up();
      if (label) {
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        await page.mouse.dblclick(center.x, center.y);
        await page.getByTestId('text-editor').waitFor();
        await typeLikeAPerson(label);
        await page.keyboard.press('Escape');
      }
    },

    /** Number of shapes currently on the board. */
    async shapeCount() {
      return page.locator('[data-shape-id]').count();
    },

    /** Drags the n-th shape (in z-order) by a fraction of the canvas. */
    async dragShape(n, dfx, dfy) {
      const shapes = page.locator('[data-shape-id]');
      const count = await shapes.count();
      if (count === 0) return false;
      const box = await shapes.nth(n % count).boundingBox();
      if (!box) return false;
      const canvas = await canvasBox();
      await tool('select');
      const from = { x: box.x + box.width / 2, y: box.y + Math.min(20, box.height / 2) };
      const to = {
        x: Math.min(
          canvas.x + canvas.width - 40,
          Math.max(canvas.x + 80, from.x + canvas.width * dfx),
        ),
        y: Math.min(
          canvas.y + canvas.height - 40,
          Math.max(canvas.y + 20, from.y + canvas.height * dfy),
        ),
      };
      await glide(from);
      await page.mouse.down();
      await glide(to, 22);
      await page.mouse.up();
      return true;
    },

    /** Clears the selection by clicking empty canvas at a fraction of the canvas. */
    async deselect(fx, fy) {
      await tool('select');
      const p = await at(fx, fy);
      await glide(p);
      await page.mouse.click(p.x, p.y);
    },

    // ---- Pages, sheets, graphs and calendars (outside the canvas: plain element clicks) ----

    /** Adds a page of a kind from the "+" menu: 'board' | 'sheet' | 'calendar'. */
    async addPage(kind) {
      await page.getByTestId('page-add').click();
      await sleep(350);
      await page.getByTestId(`page-add-${kind}`).click();
      const ready = { board: 'canvas', sheet: 'sheet-page', calendar: 'calendar-page' }[kind];
      await page.getByTestId(ready).waitFor();
      if (kind === 'board') cursor = await at(0.5, 0.5);
    },

    /** Switches to the n-th page tab (0-based) and waits for its content. */
    async openTab(n, ready) {
      await page.getByTestId('page-tab').nth(n).click();
      if (ready) await page.getByTestId(ready).waitFor();
      if (ready === 'canvas') cursor = await at(0.5, 0.5);
    },

    /** Types into sheet cells, starting at `address` and moving down with Enter. */
    async fillColumn(address, values) {
      await page.getByTestId(`cell-${address}`).click();
      for (const v of values) {
        await sleep(250);
        await typeLikeAPerson(v);
        await page.keyboard.press('Enter');
      }
    },

    /** Generates a graph from an edge list through the Graph menu (G). */
    async graphFromEdges(edges) {
      await page.keyboard.press('g');
      await page.getByTestId('graph-new').click();
      await page.getByTestId('graph-tab-edges').click();
      // The field starts with an example: replace it.
      await page.getByTestId('graph-edges').click();
      await page.keyboard.press('Control+a');
      await typeLikeAPerson(edges);
      await sleep(400);
      await page.getByTestId('graph-create').click();
      await page.getByTestId('graph-dialog').waitFor({ state: 'detached' });
    },

    /** Runs "shortest path" between two nodes in the Algorithms panel. */
    async shortestPath(from, to) {
      await press('tool-graph');
      await page.getByTestId('graph-algorithms').click();
      await page.getByTestId('algo-kind').selectOption('path');
      await sleep(300);
      await page.getByTestId('algo-start').selectOption({ label: from });
      await page.getByTestId('algo-end').selectOption({ label: to });
      await sleep(300);
      await page.getByTestId('algo-run').click();
      await page.getByTestId('algo-result').waitFor();
    },

    /**
     * Drags a timed event in the week view on the `day`-th column (0 = Monday) from `from` to
     * `to` (hours), then names it in the editor and saves it, optionally repeating weekly.
     */
    async dragEvent(day, from, to, title, { weekly = false } = {}) {
      const col = page.getByTestId('cal-week-col').nth(day);
      const box = await col.boundingBox();
      if (!box) throw new Error('week column not visible');
      const y = (h) => box.y + h * 48;
      const x = box.x + box.width / 2;
      await page.mouse.move(x, y(from) + 2);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(x, y(from) + ((y(to) - y(from)) * i) / 10);
        await sleep(30);
      }
      await page.mouse.up();
      await page.getByTestId('cal-title-input').click();
      await typeLikeAPerson(title);
      if (weekly) await page.getByTestId('cal-repeat').selectOption('weekly');
      await sleep(400);
      await page.getByTestId('cal-save').click();
      await page.getByTestId('cal-editor').waitFor({ state: 'detached' });
    },

    /** Opens the first event titled `title`, answers Going, and closes the editor. */
    async rsvpGoing(title) {
      await page.getByTestId('cal-event').filter({ hasText: title }).first().dblclick();
      await page.getByTestId('cal-rsvp-yes').click();
      await page.getByTestId('cal-rsvp-summary').filter({ hasText: '1 going' }).waitFor();
      await sleep(900);
      await page.getByTestId('cal-cancel').click();
    },

    /** Double-clicks the n-th shape and appends text to it. */
    async appendText(n, text) {
      const shapes = page.locator('[data-shape-id]');
      const count = await shapes.count();
      if (count === 0) return false;
      const box = await shapes.nth(n % count).boundingBox();
      if (!box) return false;
      const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await tool('select');
      await glide(p);
      await page.mouse.dblclick(p.x, p.y);
      const editor = page.getByTestId('text-editor');
      if (!(await editor.isVisible().catch(() => false))) return false;
      await typeLikeAPerson(text);
      await page.keyboard.press('Escape');
      return true;
    },
  };
}
