/**
 * LIVE-PREVIEW-6 conformance check. Reads `mobile/lib/app/runtime_schema.dart` as plain text
 * (no Flutter/Dart toolchain required — the bundled schema is a compile-time string literal)
 * and asserts `DEFAULT_APP_EXPERIENCE` (this port's web-side mirror) is byte-for-byte identical
 * in structure to what the real runtime actually bundles. If `kHomeSchemaJson`/`kCartSchemaJson`
 * ever change on the mobile side without this file being updated to match, this test fails —
 * the same shared-conformance discipline `runtime-contract.test.ts` (LIVE-PREVIEW-2) already
 * established for a different pair of ports.
 */
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_EXPERIENCE } from './default-experience';

const RUNTIME_SCHEMA_DART_URL = new URL('../../../../mobile/lib/app/runtime_schema.dart', import.meta.url);

/**
 * Extracts a Dart triple-quoted string literal's content by name (e.g. `kHomeSchemaJson`) from
 * the raw source text, then reverses Dart's own `\$` string-interpolation escape (the only
 * escape this particular literal uses — a literal `$` inside a Dart `'''...'''` string must be
 * written `\$` in source; Dart's own parser strips that backslash before the string ever exists
 * at runtime, so this mirrors that exact unescaping, not JSON's own escape rules).
 */
function extractDartTripleQuotedJson(source: string, constName: string): unknown {
  const pattern = new RegExp(`const String ${constName} = '''\\n([\\s\\S]*?)\\n''';`);
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Could not find "const String ${constName} = '''...''';" in runtime_schema.dart`);
  }
  const unescaped = match[1].replace(/\\\$/g, '$');
  return JSON.parse(unescaped);
}

describe('DEFAULT_APP_EXPERIENCE — conformance with mobile/lib/app/runtime_schema.dart', () => {
  const dartSource = readFileSync(fileURLToPath(RUNTIME_SCHEMA_DART_URL), 'utf-8');

  it('home page matches kHomeSchemaJson exactly', () => {
    const homeDoc = extractDartTripleQuotedJson(dartSource, 'kHomeSchemaJson') as {
      schemaVersion: string;
      minRuntimeVersion: string;
      theme?: { tokens?: Record<string, string> };
      pages: { home: unknown };
    };

    expect(homeDoc.schemaVersion).toBe(DEFAULT_APP_EXPERIENCE.schemaVersion);
    expect(homeDoc.minRuntimeVersion).toBe(DEFAULT_APP_EXPERIENCE.minRuntimeVersion);
    expect(homeDoc.theme).toEqual(DEFAULT_APP_EXPERIENCE.theme);
    expect(homeDoc.pages.home).toEqual(DEFAULT_APP_EXPERIENCE.pages.home);
  });

  it('cart page matches kCartSchemaJson exactly', () => {
    const cartDoc = extractDartTripleQuotedJson(dartSource, 'kCartSchemaJson') as {
      schemaVersion: string;
      minRuntimeVersion: string;
      pages: { cart: unknown };
    };

    expect(cartDoc.schemaVersion).toBe(DEFAULT_APP_EXPERIENCE.schemaVersion);
    expect(cartDoc.minRuntimeVersion).toBe(DEFAULT_APP_EXPERIENCE.minRuntimeVersion);
    expect(cartDoc.pages.cart).toEqual(DEFAULT_APP_EXPERIENCE.pages.cart);
  });

  it('is a single navigable two-page document rooted at home', () => {
    expect(DEFAULT_APP_EXPERIENCE.navigation.initialPageId).toBe('home');
    expect(Object.keys(DEFAULT_APP_EXPERIENCE.pages).sort()).toEqual(['cart', 'home']);
  });
});
