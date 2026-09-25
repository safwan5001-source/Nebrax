/**
 * LIVE-PREVIEW-2 conformance suite. Loads the single canonical fixture at
 * `contracts/app-builder/binding-visibility-conformance.v1.json` (read via
 * `fs`, not a static JSON import, so this test carries no TypeScript
 * module-resolution/rootDir dependency on a path outside `web/`) and
 * asserts this file's port of `mobile/lib/app/binding_resolution.dart`
 * reproduces every case's expected output exactly.
 *
 * `mobile/test/app/binding_visibility_conformance_test.dart` asserts the
 * *same* fixture file against the real Dart source. Whenever either
 * implementation's behavior changes without the shared fixture being
 * updated to match, that side's own conformance test fails — this is what
 * makes drift between the two ports detectable rather than merely
 * documented by comment. Both CI workflows (`mobile-ci.yml`, `web-ci.yml`)
 * are wired to re-run on any change to the fixture path itself, not only
 * on changes to `mobile/**`/`web/**`.
 */
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AppSchemaComponent, VisibilityNode } from '@/lib/app-builder';
import { evaluateVisibility, resolveNodeBindings } from './runtime-contract';

const FIXTURE_URL = new URL(
  '../../../../contracts/app-builder/binding-visibility-conformance.v1.json',
  import.meta.url
);

interface BindingCase {
  id: string;
  description?: string;
  node: AppSchemaComponent;
  resourceData: Record<string, unknown>;
  expected: AppSchemaComponent;
}

interface VisibilityCase {
  id: string;
  description?: string;
  condition: VisibilityNode;
  signals: Record<string, unknown>;
  expected: boolean;
}

interface ConformanceFixture {
  bindingCases: BindingCase[];
  visibilityCases: VisibilityCase[];
}

const fixture: ConformanceFixture = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), 'utf-8'));

describe('runtime-contract binding conformance (vs. mobile/lib/app/binding_resolution.dart)', () => {
  it('loads a non-empty shared fixture', () => {
    expect(fixture.bindingCases.length).toBeGreaterThan(0);
    expect(fixture.visibilityCases.length).toBeGreaterThan(0);
  });

  for (const testCase of fixture.bindingCases) {
    it(testCase.id, () => {
      const resolved = resolveNodeBindings(testCase.node, testCase.resourceData);
      expect(resolved).toEqual(testCase.expected);
    });
  }
});

describe('runtime-contract visibility conformance (vs. mobile/lib/app/binding_resolution.dart)', () => {
  for (const testCase of fixture.visibilityCases) {
    it(testCase.id, () => {
      expect(evaluateVisibility(testCase.condition, testCase.signals)).toBe(testCase.expected);
    });
  }
});
