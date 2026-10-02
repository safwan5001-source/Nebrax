'use client';

import { useSyncExternalStore } from 'react';
import { type AwjTheme, AWJ_THEME_ATTRIBUTE } from './awj-theme';

// Reactive read of the current AWJ theme (`html[data-awj-theme]`), mirroring
// use-awj-ui3.ts's pattern: the pre-paint script and the Settings selector both
// mutate the attribute outside React, so components must subscribe via
// MutationObserver rather than read it once on mount.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [AWJ_THEME_ATTRIBUTE] });
  return () => observer.disconnect();
}

function getSnapshot(): AwjTheme {
  return document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE) === 'ink' ? 'ink' : 'default';
}

// Server snapshot is always 'default': the pre-paint script runs before hydration on
// the client, but the server-rendered markup itself never carries the attribute (no
// per-request/user theme on the server — see awj-theme.ts header).
export function useAwjTheme(): AwjTheme {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'default');
}
