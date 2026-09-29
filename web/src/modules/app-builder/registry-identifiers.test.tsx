/* @vitest-environment jsdom */
/**
 * MOBILE-PREVIEW-4 conformance suite — Horizon requirement #5 ("Verify Browser Preview coverage
 * against runtime-supported component identifiers... No second independent component contract").
 *
 * Loads `contracts/app-builder/registry-identifiers.v1.json` and asserts `KNOWN_COMPONENT_TYPES`/
 * `KNOWN_ACTION_TYPES` match it exactly, then asserts `canvas.tsx`'s component `switch` actually
 * renders (never falls into the `default`/raw-type-string branch) every one of those component
 * types. `mobile/test/registry/registry_identifiers_conformance_test.dart` asserts the same
 * fixture against `RuntimeCapabilities.components`/`.actions` — the real source of truth.
 */
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSchemaComponent } from '@/lib/app-builder';
import { AppBuilderCanvas } from './canvas';
import { KNOWN_ACTION_TYPES, KNOWN_COMPONENT_TYPES } from './registry-identifiers';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : iconStub,
    has: () => true,
  });
});

afterEach(cleanup);

// `import.meta.url` is not reliably a `file:` URL under the jsdom test environment this suite
// needs for `render`/`screen` — unlike `runtime-contract.test.ts` (plain `node` environment) —
// so this resolves the shared fixture from Vitest's own working directory (`web/`) instead.
const FIXTURE_PATH = resolve(process.cwd(), '../contracts/app-builder/registry-identifiers.v1.json');
const fixture: { components: string[]; actions: string[] } = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

describe('registry-identifiers conformance (vs. mobile/lib/schema/registry_identifiers.dart)', () => {
  it('KNOWN_COMPONENT_TYPES matches the shared fixture exactly', () => {
    expect(new Set(KNOWN_COMPONENT_TYPES)).toEqual(new Set(fixture.components));
  });

  it('KNOWN_ACTION_TYPES matches the shared fixture exactly', () => {
    expect(new Set(KNOWN_ACTION_TYPES)).toEqual(new Set(fixture.actions));
  });

  it('canvas.tsx renders a real case (never the raw-type-string fallback) for every known component type', () => {
    for (const type of KNOWN_COMPONENT_TYPES) {
      const root: AppSchemaComponent = { type, id: 'probe' };
      render(<AppBuilderCanvas root={root} device="mobile" locale="en" selectedId={null} onSelect={vi.fn()} />);
      // The `default:` branch renders the bare type name as its only text content
      // (`<p>{node.type}</p>`) — every real case renders *something else* (a container, a
      // fallback glyph/dash, formatted text, ...), so this exact string must never appear
      // standing alone as the whole rendered output for a type this suite claims is supported.
      const onlyDefaultBranchText = screen.queryByText(type, { selector: 'p' });
      expect(onlyDefaultBranchText, `"${type}" fell into the unsupported/default rendering branch`).toBeNull();
      cleanup();
    }
  });
});
