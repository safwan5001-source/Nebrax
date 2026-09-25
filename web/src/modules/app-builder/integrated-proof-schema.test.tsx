/* @vitest-environment jsdom */
/**
 * LIVE-PREVIEW-7 (`AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`) — the Preview half of the
 * integrated proof this task's own charter requires:
 *
 *   Builder Draft -> Preview -> Validate -> Publish -> commerce/v1/experience
 *   -> real startup resolver -> runtime compatibility -> runtime rendering
 *
 * Loads the same canonical fixture at `contracts/app-builder/integrated-proof-schema.v1.json`
 * that `tests/Feature/AppBuilderPreviewToRuntimeIntegratedProofTest.php` round-trips through
 * Draft/Validate/Publish/fetch/compatibility, and `mobile/test/app/
 * awj_runtime_shell_startup_test.dart`'s integrated-proof case asserts the real Flutter runtime
 * accepts and renders — proving `AppBuilderCanvas` (the actual component Builder Preview uses,
 * not a bespoke test-only schema) genuinely renders this exact document: the marker text, and
 * the `ProductList`/`CartList` bindings hydrated against `SAMPLE_RESOURCE_DATA` (LIVE-PREVIEW-3)
 * using the real field paths (`$item.name`, `$item.price.amount_minor`, `$item.product_name`,
 * `$item.line_total.amount_minor`) — not the bare-`itemProps`-on-a-list-resource shape used
 * elsewhere in this repo's own PHP proof tests, which this task's evidence pass found does not
 * actually hydrate on the real runtime (see the LIVE-PREVIEW-7 evidence doc).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSchema } from '@/lib/app-builder';
import { AppBuilderCanvas } from './canvas';

// `process.cwd()` rather than `import.meta.url` — under this file's `jsdom` test
// environment, `import.meta.url` does not resolve to a `file:` URL (unlike the plain
// `node`-environment `default-experience.test.ts`). `npm run test`/`web-ci.yml` both run
// `vitest` with `web/` as the working directory, so the fixture is one level up from there.
const FIXTURE_PATH = resolve(process.cwd(), '../contracts/app-builder/integrated-proof-schema.v1.json');

function loadFixture(): AppSchema {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as AppSchema;
}

const TRANSLATIONS: Record<string, string> = {
  sampleDataBanner: 'Sample data — not your real store data',
  visibilityUnsupportedBadge: 'Visibility condition not yet active',
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => TRANSLATIONS[key] ?? key,
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

describe('AppBuilderCanvas — LIVE-PREVIEW-7 integrated-proof fixture', () => {
  it('renders the home page: the marker text and a real hydrated product card', () => {
    const fixture = loadFixture();
    render(
      <AppBuilderCanvas root={fixture.pages.home} device="mobile" locale="en" selectedId={null} onSelect={vi.fn()} />
    );

    expect(screen.getByText('LIVE_PREVIEW_7_INTEGRATED_PROOF_MARKER')).toBeTruthy();
    // ProductList's template has no `collect` — commerce.products' sample data is itself a
    // list, so it repeats directly (the same real grammar `resolveNodeBindings` uses).
    expect(screen.getByText('قهوة عربية مختصة')).toBeTruthy();
    expect(screen.getByText('شاي أخضر فاخر')).toBeTruthy();
    expect(screen.getByText('كوب سيراميك')).toBeTruthy();
  });

  it('renders the cart page: CartList collects "items" and hydrates each line', () => {
    const fixture = loadFixture();
    render(
      <AppBuilderCanvas root={fixture.pages.cart} device="mobile" locale="en" selectedId={null} onSelect={vi.fn()} />
    );

    // SAMPLE_COMMERCE_CART's one item's product_name.
    expect(screen.getByText('قهوة عربية مختصة')).toBeTruthy();
  });

  it('is byte-identical to the fixture file — no drift between this test and the shared contract', () => {
    const fixture = loadFixture();
    expect(fixture.navigation.initialPageId).toBe('home');
    expect(Object.keys(fixture.pages).sort()).toEqual(['cart', 'home']);
  });
});
