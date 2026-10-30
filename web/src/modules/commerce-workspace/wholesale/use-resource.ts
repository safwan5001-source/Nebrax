'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ResourceErrorKind = 'forbidden' | 'not_found' | 'conflict' | 'validation' | 'network' | 'unknown';

export function classifyError(error: unknown): ResourceErrorKind {
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined;
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation';
  if (typeof status === 'number') return 'unknown';
  return 'network';
}

/** Server `reason` code of a rejected request (`{message, reason}` bodies), when present. */
export function errorReason(error: unknown): string | null {
  const body = typeof error === 'object' && error !== null && 'body' in error ? (error as { body?: unknown }).body : undefined;
  if (body && typeof body === 'object' && 'reason' in body && typeof (body as { reason?: unknown }).reason === 'string') {
    return (body as { reason: string }).reason;
  }
  return null;
}

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; kind: ResourceErrorKind; error: unknown };

/**
 * One request, one state. A newer request supersedes an older one (stale responses are dropped), `reload()` re-runs
 * it, and `enabled: false` keeps the hook idle without sending anything (used while permission/channel gates apply).
 */
export function useResource<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  { enabled = true }: { enabled?: boolean } = {},
): { state: ResourceState<T>; reload: () => void } {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  const requestId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(() => {
    const id = ++requestId.current;
    setState({ status: 'loading' });
    loaderRef.current().then(
      (data) => {
        if (id === requestId.current) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (id === requestId.current) setState({ status: 'error', kind: classifyError(error), error });
      },
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      requestId.current += 1;
      return;
    }
    run();
    return () => {
      requestId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { state, reload: run };
}
