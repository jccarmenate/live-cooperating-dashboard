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

## Next steps

1. **Touch equivalents for keyboard and mouse gestures.** These have no touch path today:
   - Space-drag pan: covered by two fingers now.
   - Shift-click to add to the selection: add a "multi-select" toggle to the toolbar.
   - Double-click to edit text: check double-tap on iOS Safari.
   - Right-click menus: long-press fires `contextmenu` on Android Chrome, but not on iOS. Add a
     long-press timer, or a "⋯" button on the properties bar.
   - Keyboard shortcuts: the Help dialog lists keys a phone does not have. Hide it on
     `pointer-coarse` or show touch gestures instead.
2. **Tool on pointer-down.** Sticky, text, code and comment create their shape on pointer-down.
   A pinch that starts with one of these tools creates one shape before the second finger lands.
   Defer creation to pointer-up for touch pointers.
3. **iOS input zoom.** Inputs under 16px (sheet cell editor, page rename, title) make iOS Safari
   zoom in on focus. Use 16px on `pointer-coarse`. The canvas text editor needs care: it is
   scaled with the camera.
4. **Page tabs.** Tabs scroll sideways but show no sign that they overflow. Drag-to-reorder uses
   HTML5 drag and drop, which does not work with touch. Add a fade at the overflow edge and
   Move left/right to the tab menu.
5. **Sheet on phones.** The grid scrolls, but the format bar and formula bar take a lot of height.
   Collapse the format bar into a menu on `max-sm:`. Range selection by touch-drag needs its own
   gesture, because a drag should scroll.
6. **Calendar on phones.** Month view fits. Week view gets 7 columns about 45px wide on a phone.
   Offer a 3-day or 1-day view on `max-sm:`, and make "+N more" and the event editor sheet-style.
7. **Header overflow while voting.** "VOTE OPEN · mm:ss · N left" is wide. On `max-sm:` show only
   the timer.
8. **Toasts and dialogs:** add `env(safe-area-inset-bottom)` to the toast offset.
9. **CI:** add a `Pixel 7` Playwright project for the responsive spec, or run the whole suite
   there once the touch paths above exist.
