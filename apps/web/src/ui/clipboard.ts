/** Writes to the system clipboard; a failure leaves the in-app copy (controller.lastCopied). */
export async function writeClip(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Permission denied or unsupported: pasting in this tab still works from the in-app copy.
  }
}

/** Reads the system clipboard, or returns `fallback` when the browser refuses or it is empty. */
export async function readClip(fallback: string | null): Promise<string | null> {
  try {
    const text = await navigator.clipboard.readText();
    return text === '' ? fallback : text;
  } catch {
    return fallback;
  }
}
