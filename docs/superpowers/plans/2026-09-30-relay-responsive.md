# Relay Responsive Plan

**Goal:** Relay works on phones and tablets, in portrait and landscape, with touch, as well as it
does on a desktop with a mouse and keyboard.

**Branch:** `fix/responsive-foundation` holds the foundation and the bug fixes below. Later steps
get their own branches.

## Audit (2026-09-30)

Lint, typecheck, build, the 840 unit tests and the 37 e2e scenarios all passed before this work.
Every e2e scenario ran at `Desktop Chrome` only, so nothing covered small screens or touch. A
Playwright pass at 375×740 (phone), 740×360 (landscape phone), 768×1024 (tablet) and 1280×800
found:

| # | Bug | Where |
|---|---|---|
| 1 | Two fingers on the board drew shapes (the second finger fed the tool), and there was no way to pan or zoom by touch | `render/Canvas.tsx` |
| 2 | On phones the header squeezed the logo to 11px wide, cut "RELAY" to "RE" and wrapped "Comments · 0" and "1 online" onto two lines | `ui/Header.tsx` |
| 3 | In landscape the toolbar ran 180px past the bottom of the screen: the lower tools and **?** were unreachable, and it covered the zoom controls | `ui/Toolbar.tsx` |
| 4 | The properties bar was wider than a phone and its right half (stroke swatches, fonts, lock) was off-screen | `ui/PropertiesBar.tsx` |
| 5 | The properties bar (z-20) was drawn over the comments and algorithms panels (z-10) | `ui/CommentsPanel.tsx`, `ui/AlgorithmsPanel.tsx` |
| 6 | The 200×140 minimap covered a large part of a phone screen and a third of a landscape one | `render/Minimap.tsx` |

## Done: foundation and fixes

- **Breakpoints, one vocabulary for CSS and JS:**
  - CSS: `max-sm:` (phones, below 640px), `short:` (below 560px tall, a custom variant in
    `app/globals.css`) and Tailwind's built-in `pointer-coarse:`.
  - JS: `MEDIA` and `useMediaQuery` in `src/ui/responsive.ts`, SSR-safe through
    `useSyncExternalStore`.
- **Viewport** (`app/layout.tsx`): `viewport-fit=cover`, `interactive-widget=resizes-content` (the
  on-screen keyboard shrinks the layout rather than covering it) and a theme colour. The board
  root pads itself with the new `safe-area` utility.
- **Touch gestures:** a second finger cancels the first finger's tool gesture and becomes a
  two-finger pan and pinch zoom. The math is in `src/render/pinch.ts`, with unit tests. Fingers
  that took part stay out of the tool until they lift.
- **Header:** the logo keeps its size. On phones the wordmark and avatars hide, and Comments and
  online show as an icon and a count. The full words stay in the DOM for screen readers and tests.
- **Toolbar:** a column grid (`repeat(auto-fit, 2.25rem)` rows with a max height) that wraps into
  more columns on short screens.
- **Properties bar:** never wider than the board, and scrolls sideways.
- **Panels:** drawn above the properties bar. On phones they sit to the right of the toolbar and
  above the zoom controls. The algorithms panel scrolls when the screen is short.
- **Minimap:** 120×84 on phones and short screens.
- **Tests:** `e2e/responsive.spec.ts` runs at phone size with touch. It covers the header, panels,
  properties bar, the landscape toolbar and pinch versus one-finger drawing. All three scenarios
  fail on the code before these fixes.

## Done: touch gestures (steps 1–3)

- **Long press** (500 ms, finger within 10px) opens the canvas menu, the same way on iOS and
  Android. The browser's own `contextmenu` and `dblclick` after a finger are ignored, so nothing
  opens twice. Page tabs open their menu the same way (`useLongPress`).
- **Double tap** (300 ms, 24px) edits text, as a double-click does.
- **Add to selection:** a toolbar toggle, on `pointer-coarse` only, stands in for Shift+click
  (never on resize handles, where Shift locks the aspect ratio).
- **Single-press tools** (sticky, text, code, comment) wait for the finger to lift, so a pinch
  or a long press never drops a shape.
- **Help** leads with a Touch group on touch screens ("Gestures and shortcuts").
- **Page tabs:** Move left and Move right in the tab menu. Tabs are not `draggable` on touch
  screens, where a held finger would start a native drag instead of the menu.
- **iOS input zoom:** on iOS only, `maximum-scale=1` is added to the viewport (`IosInputZoom`).
  iOS then stops zooming into small fields and still allows pinch zoom. Android is left alone,
  where the same setting would block pinch zoom.
- **Bug found by the new tests:** on a phone the properties bar was placed over the toolbar, so
  no tool could be tapped while something was selected. It now stays right of the toolbar.
- **Tests:** unit tests for the gesture rules and the viewport string; e2e scenarios for lift,
  long press, double tap, the toggle, the tab menu and help. Each fails on the previous code.

## Done: sheet, tabs, header and toasts

- **Sheet by touch:**
  - A drag scrolls the grid without moving the selection. Selection used to follow the finger
    until the browser took it for a scroll, and `pointercancel` was not handled.
  - A tap selects a cell, and a tap on the selected cell edits it. The editor takes focus inside
    the tap (`flushSync`), which iOS needs to show the keyboard. The browser's own `dblclick`
    after a finger is ignored.
  - Press and hold (500 ms), then drag, selects a range. A non-passive `touchmove` stops the grid
    scrolling under the finger.
  - Row and column headers open their menu on a long press.
  - The fill handle is `touch-none`, with a 34px hit area on touch screens.
- **Page tabs:** fades on the edges that hide tabs, and the active tab scrolls into view with
  room for the fade (`scroll-mx-8`).
- **Header while voting:** on phones the vote pill shows "2:59 · 3 left" and Share is an icon.
  The full words stay in the DOM.
- **Toasts:** clear of the home indicator (`env(safe-area-inset-bottom)`), and wrap within the
  screen.
- **Tests:** two phone e2e scenarios (sheet by touch; tab fades and the vote header). Both fail
  on the previous code.

## Done: calendar by touch

- **Bug:** in the week view the time grid and its events were `touch-none`, so a finger could not
  scroll the hours at all: every touch started creating (or moving) an event.
- **Week view by touch:** a drag scrolls. A tap on an empty slot creates a one-hour event there.
  A tap selects an event, and a tap on the selected event opens it. Press and hold (500 ms), then
  drag, creates, moves or resizes as a mouse drag does. A non-passive `touchmove` stops the
  scroll under a held finger. The resize handle is taller on touch screens.
- **Week view on phones:** day columns are at least 5.5rem wide (`--day-min`), so about three and
  a half days show at once. One scroller now scrolls both axes, with the day header and all-day
  row sticky on top and the hour labels sticky on the left. Each week opens on today when the
  days scroll sideways. On desktop it looks as before.
- **Month view and all-day bars:** a tap on the selected event opens it. The browser's own
  `dblclick` after a finger is ignored (`useEventDrag.onDoubleClick`). Month chips still drag at
  once: the month grid does not scroll, so nothing competes with the drag.
- **Tests:** two phone e2e scenarios, one for the week (scroll both ways, tap to create, tap to
  select and open, hold to move) and one for the month (tap to create, select and open). Both
  fail on the previous code. The taps that open an event are 600 ms apart, so Chromium's own
  double-tap `dblclick` cannot make them pass.

## Done: the remaining steps and a last audit

- **Sheet:** row and column header menus gain Move up/down and Move left/right. By touch a
  header drag scrolls the grid, so moving has to go through the menu. It works with a mouse too.
- **Month view:** a vertical swipe on the grid rolls it a week per row, as the mouse wheel does
  (`useCalendarSwipe`). The grid is `touch-none` on touch screens so the browser never takes the
  swipe. Swipes that start on an event are drags, and swipes in "+N more" scroll the list.
- **CI:** Playwright has a `phone` project (a Pixel 7 profile pinned to 375 × 740) that runs
  `e2e/responsive.spec.ts`; the desktop project skips it. `npm run e2e` runs both.
- **Last audit** (375 × 740 and 740 × 360) of what had not been checked:
  - **Bug:** a comment placed near the right edge opened its composer off-screen (x 367 of 375)
    and its thread off the board. Both are now kept inside the board (`popover.ts`). A thread
    opens on the side of its pin with more room, and its list shrinks to fit.
  - **Bug:** an open thread was drawn under the minimap and zoom controls: the pin's
    `transform` made it a stacking context, so the thread's own z-index had no effect.
  - The calendar header took two rows in landscape. On phones and short screens the time zone
    moves into the ⋯ menu, so the header keeps to one row.
  - On short screens the sheet's format and formula bars share one row, leaving room for cells.
  - The New graph, Add to calendar, Share and event editor dialogs fit at both sizes.
- **Tests:** swipe and placement unit tests; two phone e2e scenarios (header menus and the
  month swipe; comments at the edge and the landscape bars). Each fails on the previous code.

## Next steps

1. **Real devices:** everything above was checked in Chromium's touch emulation. Check iOS
   Safari (double tap, long press, tap-to-edit keyboard, input zoom, week scrolling, month swipe)
   and Android Chrome on hardware. Playwright's WebKit is not iOS Safari, so it does not replace
   this.
2. **Comment pins at the edge:** a pin anchored within ~40px of the right edge is clipped; pan
   to reach it. A pin could keep itself inside the board.
3. **Sheet:** a multi-row selection's menu moves only the row that was pressed.
