import { MAX_CONNECTOR_LABEL } from '@relay/core';

/**
 * Whether committing `value` would leave the label the editor opened with (`initial`, '' when
 * none) as it was, after the same trim and cap SetConnectorLabel applies. An unchanged commit
 * must write nothing: no invisible undo step, and no stale value over a peer's newer label.
 */
export function labelUnchanged(initial: string, value: string): boolean {
  return value.trim().slice(0, MAX_CONNECTOR_LABEL) === initial;
}
