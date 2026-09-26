import type { Shape } from '@relay/core';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

/**
 * The document shape with the local overlay applied. While this user drags or
 * resizes, the overlay holds the latest geometry (updated every pointer move)
 * and the document catches up through throttled commits.
 */
export function useShape(session: BoardSession, id: string | null): Shape | undefined {
  const base = useStore(session.doc, (s) => (id ? s.shapes[id] : undefined));
  const over = useStore(session.controller.ui, (s) => (id ? s.overlay?.[id] : undefined));
  return useMemo(() => (base && over ? { ...base, ...over } : base), [base, over]);
}
