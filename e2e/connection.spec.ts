import { expect, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

test('a tab holds one room socket, and it carries a session id', async ({ page, request }) => {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const sockets: string[] = [];
  page.on('websocket', (ws) => {
    if (ws.url().includes('/parties/room/')) sockets.push(ws.url());
  });
  await page.goto(`/r/${roomId}#k=${editKey}`);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
  // A socket opened by a connection React had already thrown away would be here too.
  await page.waitForTimeout(500);
  expect(sockets).toHaveLength(1);
  expect(new URL(sockets[0] as string).searchParams.get('sid')).toMatch(/^[0-9a-f]{32}$/);
});
