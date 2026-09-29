/**
 * MOBILE-PREVIEW-4 conformance suite. Loads the single canonical fixture at
 * `contracts/app-builder/action-navigation-conformance.v1.json` (read via `fs`, not a static
 * JSON import — same reasoning as `runtime-contract.test.ts`) and asserts this file's port of
 * `mobile/lib/actions/app_action.dart`'s `decodeAction` reproduces every case's `decode` result
 * exactly, and that `resolvePreviewActionOutcome` reproduces every case's `previewOutcome`.
 *
 * `mobile/test/actions/action_navigation_conformance_test.dart` asserts the *same* fixture's
 * `decode` field against the real Dart source, and its `navigate`/`navigate-unsupported` split
 * against the real `RuntimeActionHandler.onNavigate`.
 */
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AppSchemaActionRef } from '@/lib/app-builder';
import { decodeAppAction, resolvePreviewActionOutcome, type PreviewActionOutcome } from './action-semantics';

const FIXTURE_URL = new URL(
  '../../../../contracts/app-builder/action-navigation-conformance.v1.json',
  import.meta.url
);

interface ActionCase {
  id: string;
  description?: string;
  action: AppSchemaActionRef;
  decode: Record<string, unknown> | null;
  previewOutcome: PreviewActionOutcome;
}

interface ConformanceFixture {
  cases: ActionCase[];
}

const fixture: ConformanceFixture = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), 'utf-8'));

describe('action-semantics decode conformance (vs. mobile/lib/actions/app_action.dart)', () => {
  it('loads a non-empty shared fixture', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const testCase of fixture.cases) {
    it(`${testCase.id} — decode`, () => {
      expect(decodeAppAction(testCase.action)).toEqual(testCase.decode);
    });

    it(`${testCase.id} — previewOutcome`, () => {
      expect(resolvePreviewActionOutcome(testCase.action)).toEqual(testCase.previewOutcome);
    });
  }
});
