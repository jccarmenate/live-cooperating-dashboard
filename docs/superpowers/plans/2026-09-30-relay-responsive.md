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

## Next steps

1. **Page tabs:** a fade at the overflow edge, so it shows that more tabs scroll into view.
2. **Sheet on phones.** The grid scrolls, but the format bar and formula bar take a lot of height.
   Collapse the format bar into a menu on `max-sm:`. Range selection by touch-drag needs its own
   gesture, because a drag should scroll. Column and row header menus need a long press too.
3. **Calendar on phones.** Month view fits. Week view gets 7 columns about 45px wide on a phone.
   Offer a 3-day or 1-day view on `max-sm:`, and make "+N more" and the event editor sheet-style.
4. **Header overflow while voting.** "VOTE OPEN · mm:ss · N left" is wide. On `max-sm:` show only
   the timer.
5. **Toasts and dialogs:** add `env(safe-area-inset-bottom)` to the toast offset.
6. **CI:** add a `Pixel 7` Playwright project for the responsive spec.
7. **Real devices:** everything above was checked in Chromium's touch emulation. Check iOS Safari
   (double tap, long press, input zoom) and Android Chrome on hardware.
