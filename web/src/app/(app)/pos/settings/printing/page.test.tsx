import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import PosPrintingSettingsPage from './page';

describe('مسار إعدادات الطباعة القديم', () => {
  it('يعيد توجيه المستخدم إلى التهيئة الموحدة', () => {
    PosPrintingSettingsPage();

    expect(mocks.redirect).toHaveBeenCalledWith('/pos/settings/configuration');
  });
});
