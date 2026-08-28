import { describe, expect, it } from 'vitest';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';
import { POS_SHORTCUTS, findPosShortcutByKey } from './shortcut-registry';

describe('سجل اختصارات نقطة البيع', () => {
  it('لا يحمل مفتاحاً مكرراً ولا معرّفاً مكرراً فلا يتنازع اختصاران على ضغطة واحدة', () => {
    const keys = POS_SHORTCUTS.map((shortcut) => shortcut.key);
    const ids = POS_SHORTCUTS.map((shortcut) => shortcut.id);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('يحفظ الاختصارات القائمة كما هي بلا إضافة اختصار جديد', () => {
    expect(POS_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut.key])).toEqual([
      ['customer', 'F2'],
      ['search', 'F4'],
      ['delete', 'F8'],
      ['payment', 'F9'],
      ['back', 'Escape'],
    ]);
  });

  it('يترجم كل اختصار في العربية والإنجليزية بلا نص مكتوب في الكود', () => {
    for (const shortcut of POS_SHORTCUTS) {
      const ar = (arMessages.pos as Record<string, string>)[shortcut.translationKey];
      const en = (enMessages.pos as Record<string, string>)[shortcut.translationKey];
      expect(ar, `ar.pos.${shortcut.translationKey}`).toBeTruthy();
      expect(en, `en.pos.${shortcut.translationKey}`).toBeTruthy();
    }
  });

  it('يبحث بقيمة `KeyboardEvent.key` لا بالتسمية المعروضة', () => {
    expect(findPosShortcutByKey('Escape')?.id).toBe('back');
    expect(findPosShortcutByKey('Esc')).toBeUndefined();
    expect(findPosShortcutByKey('F5')).toBeUndefined();
  });
});
