'use client';

import { useSyncExternalStore } from 'react';

// Reactive read of the AWJ v3 gate (`html[data-awj-ui="3"]`, see awj-ui-gate.ts).
// The (app) layout applies the attribute in an effect that runs AFTER child effects,
// so components must subscribe rather than read once. Server snapshot is always
// `false`: gate-off markup is what the server and first client render produce.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-awj-ui'] });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.getAttribute('data-awj-ui') === '3';
}

export function useAwjUi3(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
