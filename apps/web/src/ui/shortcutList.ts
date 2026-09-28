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
    ],
  },
  {
    title: 'Edit',
    items: [
      ['Ctrl C · X · V', 'Copy · cut · paste'],
      ['Ctrl D', 'Duplicate'],
      ['Ctrl A', 'Select all'],
      ['Del', 'Delete'],
      ['Arrows', 'Nudge (Shift: 10 px)'],
      [']', 'Bring to front'],
      ['[', 'Send to back'],
      ['E', 'Straight / elbow connector'],
      ['Ctrl Z', 'Undo'],
      ['Ctrl Shift Z', 'Redo'],
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
