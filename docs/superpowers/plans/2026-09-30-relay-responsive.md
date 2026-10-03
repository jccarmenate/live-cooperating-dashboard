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

## Done: actions that needed a keyboard

- **Undo and redo** were Ctrl+Z and Ctrl+Y only, so a phone could not undo anything. They are
  now buttons at the right end of the tab row, on every page type and every device, disabled
  when there is nothing to undo or redo (`canUndo` and `canRedo` in the controller's UI state).
  They keep the focus where it is, so a press never commits a cell being edited. Viewers have
  none.
- **Sheet cells** had no way to copy, paste or clear a range without Ctrl+C, Ctrl+V and Delete.
  The selected cells now have a menu (Cut, Copy, Paste, Clear contents; viewers only Copy):
  press and hold a cell and lift without dragging on a touch screen, right-click with a mouse. A
  hold or right-click inside the selection keeps it. Paste falls back on the last text copied
  here when the browser refuses to read the clipboard.
- **Column width:** the resize handle is `touch-none` and 24px wide on touch screens, so a
  finger drags it instead of scrolling the grid.
- **Board resize handles:** each 9px handle answers to a 26px area on touch screens.
- **Tests:** controller and cell-menu unit tests; two phone e2e scenarios and a desktop one
  (right-click menu, undo buttons, viewers). Each fails on the previous code.
- **Found while testing:** a touch drag released at speed is a fling to Chrome, which then
  swallows the next tap. The synthetic drags in the e2e rest before they lift, as a finger does.
  Worth a look on hardware: a fast flick followed at once by a tap on a button may need a second
  tap.

## Done: tablets and the on-screen keyboard

- **Tablets** (768 × 1024 and 1024 × 768, touch) were audited: the board, panels, menus, the
  sheet and both calendar views. Nothing needed fixing. A tablet is wider than 640px, so it gets
  the desktop layout, with the touch gestures and the touch-only controls (`pointer-coarse`). A
  week's seven days fit without scrolling sideways.
- **CI:** Playwright has a `tablet` project (a Galaxy Tab S4 profile at 768 × 1024) that runs
  `e2e/tablet.spec.ts`. Its two scenarios are regression guards: they pass before and after
  this work.
- **On-screen keyboard:** the keyboard shrinks the board (Android, through
  `interactive-widget=resizes-content`) or only the visual viewport (iOS). A sticky in the lower
  half then sat under it while being edited. On touch screens the camera now pans just enough to
  keep the edited shape in what is left (`revealPan`, wired in `TextEditor`). With a mouse the
  camera never moves by itself.
- **Tests:** unit tests for the pan; a phone e2e scenario that shrinks the layout (as Android
  does) and then only the visual viewport (as iOS does). It fails on the previous code.

## Done: visual polish

- **Control sizes are tokens.** `app/globals.css` defines `--spacing-tool`, `--spacing-ctl`,
  `--spacing-ctl-sm`, `--spacing-swatch` and `--spacing-row` (used as `size-tool`, `h-ctl`, …),
  and one `@media (pointer: coarse)` block gives them finger-sized values. With a mouse nothing
  changes; on a touch screen:

  | Control | Mouse | Touch |
  |---|---|---|
  | Toolbar buttons | 36px | 40px |
  | Page tabs, zoom, calendar header buttons | 32px | 40px |
  | Undo, redo, new page, format and properties buttons | 28px | 36px |
  | Colour swatches | 20px | 32px |
  | Tab row, formula bar | 36px | 44px |
  | Header buttons (Vote, Comments, Share) | 25px | 37px |

  Text buttons, menu items and dialog fields get more vertical padding on touch screens
  (`pointer-coarse:py-*`).
- **Type:** `text-[10px]` and `text-[9px]` became the tokens `text-2xs` and `text-3xs`; on touch
  screens both are 11px, so no text is smaller than that.
- **Empty-page hint:** on touch screens it reads "Tap a tool, then the board · Two fingers to pan
  and zoom · ? for help" instead of listing keys, and on phones and short screens it centres in
  the room beside the toolbar instead of under it.
- **Toolbar:** the room it leaves for the zoom controls follows their size. In landscape on a
  phone it is three rows of four.
- **Tests:** the phone scenario asserts the touch sizes and the hint (it fails on the previous
  code); a desktop scenario asserts the mouse sizes and the key hint stay as they were.

Left as they are, on purpose:

- The toolbar stays a fixed column on a phone (58px of 375), and in landscape the header and tab
  row take 92 of 360px. Collapsing either is a design change, not a fix.
- Controls stop at 36–40px rather than 44–48px: at 44px the phone toolbar would need two columns
  in portrait. The 6px gaps bring the pitch to 46px.
- Sheet rows stay 28px high and calendar chips 18px: both are layout constants shared with the
  mouse layout.
- With the larger swatches the properties bar is wider than a phone; it scrolls sideways.

## Done: review before merging

A review of the whole branch against `main` found ten things. Six were fixed:

- **Resize handles on small shapes:** the 26px touch area of each handle was a fixed screen size,
  so on a small or zoomed-out shape the eight areas covered it and a finger could only resize
  it. The area is now at most a third of the shape (`handleHitPx`).
- **Shapes flyout:** it had no z-index, so in a toolbar wrapped into columns the Graph and ?
  buttons could paint over it.
- **Long press on a tab:** the click some browsers send as the finger lifts no longer also
  switches to that tab (`useLongPress` swallows it).
- **Sheet headers:** a finger selects a row or column when it lifts, so a scroll that starts on
  the headers no longer changes the selection.
- **Paste from the cell menu** falls back on the sheet's own last copy, including a Ctrl+C
  (`SheetController.lastCopied`), when the browser refuses to read the clipboard.
- **The fill handle by touch** had no test; it has one now. A stale comment and a literal 28
  beside `PIN_H` were tidied.

One did not reproduce: the undo button keeps the focus with a mouse in Chromium (a draft in a
cell survives the click). It now cancels `mousedown` as well, like the other bar buttons.

Two were left:

- Canvas, SheetGrid and WeekView each have their own press-and-hold timer beside
  `useLongPress`. They differ (a hold there becomes a drag), so merging them is a refactor.
- The double-tap e2e sends two taps as four CDP calls and needs them inside 300 ms. It has never
  failed here; CI retries once.

## Next steps

1. **Real devices:** everything above was checked in Chromium's touch emulation. Check iOS
   Safari (double tap, long press, tap-to-edit keyboard, input zoom, week scrolling, month swipe,
   the tap after a fast drag, a sticky edited under the keyboard) and Android Chrome on hardware.
2. **WebKit:** Playwright's WebKit is not installed here. It is the closest engine to iOS Safari
   that can run in CI: add a WebKit project for the phone spec. It does not replace hardware.
3. **Comment pins at the edge:** a pin anchored within ~40px of the right edge is clipped; pan
   to reach it. A pin could keep itself inside the board.
4. **Sheet:** a multi-row selection's menu moves only the row that was pressed; rows are 28px
   high on touch screens too.
5. **Tests:** no visual regression tests.
