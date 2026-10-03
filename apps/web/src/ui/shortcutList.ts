/** Touch gestures on the board, listed first in the help dialog on touch screens. */
export const TOUCH_GROUP = {
  title: 'Touch',
  items: [
    ['Two fingers', 'Pan and pinch to zoom'],
    ['Double-tap', 'Edit text'],
    ['Press and hold', 'Menu'],
    ['Add to selection', 'Toolbar toggle: taps add to the selection'],
  ],
} as const satisfies { title: string; items: readonly (readonly [string, string])[] };

/** Every board shortcut, grouped, for the help dialog. Keep in sync with shortcuts.ts. */
export const SHORTCUT_GROUPS = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select'],
      ['R', 'Rectangle'],
      ['O', 'Ellipse'],
      ['L', 'Line'],
      ['A', 'Connector'],
      ['T', 'Text'],
      ['S', 'Sticky note'],
      ['C', 'Code block'],
      ['F', 'Frame'],
      ['M', 'Comment'],
      ['G', 'Graph menu'],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['Ctrl C · X · V', 'Copy · cut · paste'],
      ['Ctrl D', 'Duplicate'],
      ['Ctrl A', 'Select all'],
      ['Del / Backspace', 'Delete'],
      ['Arrows', 'Nudge (Shift: 10 px)'],
      [']', 'Bring to front'],
      ['[', 'Send to back'],
      ['E', 'Straight / elbow connector'],
      ['Ctrl Z', 'Undo'],
      ['Ctrl Shift Z / Ctrl Y', 'Redo'],
      ['Esc', 'Cancel'],
    ],
  },
  {
    title: 'View',
    items: [
      ['Space + drag', 'Pan'],
      ['Wheel', 'Pan'],
      ['Ctrl + wheel', 'Zoom'],
      ['Shift 1', 'Zoom to fit'],
      ['?', 'This help'],
    ],
  },
  {
    title: 'Mouse',
    items: [
      ['Double-click', 'Edit text'],
      ['Right-click', 'Menu'],
      ['Shift + click', 'Add to selection'],
    ],
  },
] as const satisfies readonly { title: string; items: readonly (readonly [string, string])[] }[];
