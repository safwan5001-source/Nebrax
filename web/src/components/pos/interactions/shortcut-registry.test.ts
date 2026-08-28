// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';
import {
  POS_SHORTCUT_BINDINGS,
  POS_SHORTCUT_FOOTER,
  matchPosShortcut,
  posShortcutBindingKey,
} from './shortcut-registry';

describe('سجل اختصارات نقطة البيع', () => {
  it('لا يحمل ربط مفتاح مكرراً', () => {
    const keys = POS_SHORTCUT_BINDINGS.map(posShortcutBindingKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('يشمل اختصارات وضع لوحة المفاتيح الجديدة', () => {
    const ids = POS_SHORTCUT_FOOTER.map((binding) => binding.id);
    expect(ids).toEqual([
      'customer', 'search', 'heldSales', 'holdSale', 'delete', 'payment', 'newCart', 'openCarts', 'back',
    ]);
  });

  it('يترجم كل اختصار ظاهر في الشريط بالعربية والإنجليزية', () => {
    for (const shortcut of POS_SHORTCUT_FOOTER) {
      const ar = (arMessages.pos as Record<string, string>)[shortcut.translationKey];
      const en = (enMessages.pos as Record<string, string>)[shortcut.translationKey];
      expect(ar, `ar.pos.${shortcut.translationKey}`).toBeTruthy();
      expect(en, `en.pos.${shortcut.translationKey}`).toBeTruthy();
    }
  });

  it('يطابق اختصارات الم modifiers', () => {
    const ctrlN = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true });
    expect(matchPosShortcut(ctrlN)?.id).toBe('newCart');

    const ctrlShiftO = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    expect(matchPosShortcut(ctrlShiftO)?.id).toBe('openCarts');

    const ctrlAltN = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    expect(matchPosShortcut(ctrlAltN)?.id).toBe('newCart');
  });
});
