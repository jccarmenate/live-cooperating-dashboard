'use client';

import { useEffect } from 'react';
import { withMaximumScale } from './responsive';

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac; touch points give it away.
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/**
 * iOS only: stops Safari zooming into every focused field under 16px (sheet cells, page names,
 * the canvas text editor). Elsewhere `maximum-scale` would block pinch zoom, so it is left out.
 */
export function IosInputZoom() {
  useEffect(() => {
    if (!isIos()) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (meta) meta.content = withMaximumScale(meta.content);
  }, []);
  return null;
}
