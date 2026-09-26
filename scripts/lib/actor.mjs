// Drives the real Relay UI with Playwright, the way a person would:
// toolbar clicks, pointer drags and typing. Used by the demo bot and the
// README capture script.

export const SYNC = process.env.RELAY_SYNC ?? 'http://localhost:8787';
export const WEB = process.env.RELAY_WEB ?? 'http://localhost:3000';

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

  async function tool(id) {
    await page.getByTestId(`tool-${id}`).click();
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
