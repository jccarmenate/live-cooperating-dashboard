/** Yjs protocol message types (the varint a frame starts with). */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** Sync sub-types that carry a document update (the varint after the type of a sync frame). */
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;
