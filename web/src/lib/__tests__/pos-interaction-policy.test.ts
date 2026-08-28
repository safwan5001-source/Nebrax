import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PosInputModality } from '@/components/pos/interactions/pos-input-modality';
import {
  parsePosInteractionMode,
  posInteractionViewport,
  posInteractionViewportFromMedia,
  resolvePosInteractionPolicy,
  type PosInteractionMode,
  type PosInteractionViewport,
} from '@/lib/pos-interaction-policy';

const MODALITIES: PosInputModality[] = ['keyboard', 'pointer', 'scanner'];
const VIEWPORTS: PosInteractionViewport[] = ['phone', 'tablet', 'desktop'];
const MODES: PosInteractionMode[] = ['AUTO', 'TOUCH', 'KEYBOARD_MOUSE', 'HYBRID'];

describe('parsePosInteractionMode', () => {
  it('يقبل القيم الرسمية الأربع فقط', () => {
    expect(parsePosInteractionMode('AUTO')).toBe('AUTO');
    expect(parsePosInteractionMode('TOUCH')).toBe('TOUCH');
    expect(parsePosInteractionMode('KEYBOARD_MOUSE')).toBe('KEYBOARD_MOUSE');
    expect(parsePosInteractionMode('HYBRID')).toBe('HYBRID');
  });

  it('يسقط على AUTO عند الغياب أو القيمة القديمة أو غير الصالحة', () => {
    expect(parsePosInteractionMode(undefined)).toBe('AUTO');
    expect(parsePosInteractionMode(null)).toBe('AUTO');
    expect(parsePosInteractionMode('')).toBe('AUTO');
    expect(parsePosInteractionMode('auto')).toBe('AUTO');
    expect(parsePosInteractionMode('legacy_touch')).toBe('AUTO');
    expect(parsePosInteractionMode('keyboard')).toBe('AUTO');
    expect(parsePosInteractionMode(1)).toBe('AUTO');
  });
});

describe('posInteractionViewport', () => {
  it('يستخدم كسور PR-6 دون اختراع عتبات', () => {
    expect(posInteractionViewport(390)).toBe('phone');
    expect(posInteractionViewport(767)).toBe('phone');
    expect(posInteractionViewport(768)).toBe('tablet');
    expect(posInteractionViewport(1023)).toBe('tablet');
    expect(posInteractionViewport(1024)).toBe('desktop');
    expect(posInteractionViewportFromMedia(true, true)).toBe('desktop');
    expect(posInteractionViewportFromMedia(false, true)).toBe('tablet');
    expect(posInteractionViewportFromMedia(false, false)).toBe('phone');
  });
});

describe('resolvePosInteractionPolicy', () => {
  it('يبقي الماسح مفعّلاً في كل وضع وعرض ووسيط', () => {
    for (const mode of MODES) {
      for (const viewport of VIEWPORTS) {
        for (const lastModality of MODALITIES) {
          expect(resolvePosInteractionPolicy(mode, { viewport, lastModality }).scannerEnabled).toBe(true);
        }
      }
    }
  });

  it('AUTO: تكيّف يحترم العرض — الهاتف يميل للمس حتى مع لوحة المفاتيح', () => {
    const phoneKeyboard = resolvePosInteractionPolicy('AUTO', { viewport: 'phone', lastModality: 'keyboard' });
    expect(phoneKeyboard.allowKeyboardPowerMode).toBe(false);
    expect(phoneKeyboard.restoreKeyboardFocus).toBe(false);
    expect(phoneKeyboard.showShortcutHints).toBe(false);
    expect(phoneKeyboard.preferTouchTargets).toBe(true);
    expect(phoneKeyboard.adaptiveModality).toBe(true);

    const desktopKeyboard = resolvePosInteractionPolicy('AUTO', { viewport: 'desktop', lastModality: 'keyboard' });
    expect(desktopKeyboard.allowKeyboardPowerMode).toBe(true);
    expect(desktopKeyboard.restoreKeyboardFocus).toBe(true);
    expect(desktopKeyboard.showShortcutHints).toBe(true);
    expect(desktopKeyboard.preferTouchTargets).toBe(false);

    const desktopPointer = resolvePosInteractionPolicy('AUTO', { viewport: 'desktop', lastModality: 'pointer' });
    expect(desktopPointer.allowKeyboardPowerMode).toBe(false);
    expect(desktopPointer.restoreKeyboardFocus).toBe(false);
    expect(desktopPointer.showShortcutHints).toBe(true);

    const desktopScanner = resolvePosInteractionPolicy('AUTO', { viewport: 'desktop', lastModality: 'scanner' });
    expect(desktopScanner.allowKeyboardPowerMode).toBe(false);
    expect(desktopScanner.restoreKeyboardFocus).toBe(false);
  });

  it('TOUCH: يخفي Keyboard Power Mode والاختصارات ويستعيد التركيز، ويبقى الماسح', () => {
    for (const viewport of VIEWPORTS) {
      for (const lastModality of MODALITIES) {
        const policy = resolvePosInteractionPolicy('TOUCH', { viewport, lastModality });
        expect(policy.allowKeyboardPowerMode).toBe(false);
        expect(policy.showShortcutHints).toBe(false);
        expect(policy.restoreKeyboardFocus).toBe(false);
        expect(policy.preferTouchTargets).toBe(true);
        expect(policy.adaptiveModality).toBe(false);
        expect(policy.scannerEnabled).toBe(true);
      }
    }
  });

  it('KEYBOARD_MOUSE: تلميحات سطح المكتب دون فرض لوحة بعد المؤشر', () => {
    const desktopKeyboard = resolvePosInteractionPolicy('KEYBOARD_MOUSE', { viewport: 'desktop', lastModality: 'keyboard' });
    expect(desktopKeyboard.allowKeyboardPowerMode).toBe(true);
    expect(desktopKeyboard.restoreKeyboardFocus).toBe(true);
    expect(desktopKeyboard.showShortcutHints).toBe(true);
    expect(desktopKeyboard.adaptiveModality).toBe(false);

    const desktopPointer = resolvePosInteractionPolicy('KEYBOARD_MOUSE', { viewport: 'desktop', lastModality: 'pointer' });
    expect(desktopPointer.allowKeyboardPowerMode).toBe(false);
    expect(desktopPointer.restoreKeyboardFocus).toBe(false);
    expect(desktopPointer.showShortcutHints).toBe(true);

    const phone = resolvePosInteractionPolicy('KEYBOARD_MOUSE', { viewport: 'phone', lastModality: 'keyboard' });
    expect(phone.showShortcutHints).toBe(false);
    expect(phone.preferTouchTargets).toBe(true);
    expect(phone.allowKeyboardPowerMode).toBe(true);
  });

  it('HYBRID: يتبع آخر وسيط حتى على الهاتف ولا يحوّل الماسح إلى لوحة', () => {
    const phoneKeyboard = resolvePosInteractionPolicy('HYBRID', { viewport: 'phone', lastModality: 'keyboard' });
    expect(phoneKeyboard.allowKeyboardPowerMode).toBe(true);
    expect(phoneKeyboard.adaptiveModality).toBe(true);
    expect(phoneKeyboard.restoreKeyboardFocus).toBe(true);

    const phonePointer = resolvePosInteractionPolicy('HYBRID', { viewport: 'phone', lastModality: 'pointer' });
    expect(phonePointer.allowKeyboardPowerMode).toBe(false);
    expect(phonePointer.restoreKeyboardFocus).toBe(false);

    const scanner = resolvePosInteractionPolicy('HYBRID', { viewport: 'desktop', lastModality: 'scanner' });
    expect(scanner.allowKeyboardPowerMode).toBe(false);
    expect(scanner.restoreKeyboardFocus).toBe(false);
    expect(scanner.showShortcutHints).toBe(true);
    expect(scanner.scannerEnabled).toBe(true);
  });
});

describe('عزل مصدر السياسة', () => {
  function source(file: string) {
    return readFileSync(resolve(process.cwd(), file), 'utf8');
  }

  it('يربط صفحة البيع بالسياسة دون لمس auth أو Dialog العام أو سجل الاختصارات أو عتبات الماسح', () => {
    const page = source('src/app/(pos)/pos/page.tsx');
    expect(page).toContain('resolvePosInteractionPolicy');
    expect(page).toContain('parsePosInteractionMode');
    expect(page).toContain("from '@/lib/pos-interaction-policy'");
    expect(page).toContain('policy.scannerEnabled && step === \'sale\' && !dialogOpen');
    expect(page).not.toContain("from '@/components/ui/dialog'");

    const registry = source('src/components/pos/interactions/shortcut-registry.ts');
    expect(registry).not.toContain('interaction_mode');
    expect(registry).not.toContain('pos-interaction-policy');

    const scanner = source('src/components/pos/interactions/use-pos-barcode-scanner.ts');
    expect(scanner).toContain('POS_SCANNER_MIN_LENGTH = 3');
    expect(scanner).toContain('POS_SCANNER_MAX_GAP_MS = 80');

    const auth = source('src/lib/auth.ts');
    expect(auth).not.toContain('pos-interaction-policy');
    expect(auth).not.toContain('PosDialog');
  });
});
