import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { POS_SHORTCUT_FOOTER } from '@/components/pos/interactions/shortcut-registry';
import { TEST_LOCALES, TEST_MESSAGES, renderIntl } from '@/test-utils/intl';
import { PosShortcuts } from './pos-shortcuts';

afterEach(cleanup);

describe('شريط اختصارات نقطة البيع', () => {
  it.each(TEST_LOCALES)('يعرض اختصارات السجل نفسها بترجمة %s', (locale) => {
    renderIntl(<PosShortcuts />, locale);

    const messages = TEST_MESSAGES[locale].pos as Record<string, string>;
    for (const shortcut of POS_SHORTCUT_FOOTER) {
      expect(screen.getByText(shortcut.displayKey)).toBeDefined();
      expect(screen.getByText(messages[shortcut.translationKey])).toBeDefined();
    }
    expect(document.querySelectorAll('kbd')).toHaveLength(POS_SHORTCUT_FOOTER.length);
  });

  it('يخفي الشريط بالكامل عندما تمنع السياسة التلميحات', () => {
    renderIntl(<PosShortcuts visible={false} />, 'ar');
    const footer = document.querySelector('[data-testid="pos-shortcut-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains('hidden')).toBe(true);
    expect(footer?.getAttribute('data-visible')).toBe('false');
  });
});
