// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PosSettingsPage from './page';

const strings: Record<string, string> = {
  'posSettings.title': 'POS settings',
  'posSettings.hub_subtitle': 'Manage POS.',
  'posSettings.group_setup': 'Setup',
  'posSettings.c_configuration_t': 'POS configuration',
  'posSettings.c_configuration_d': 'Configuration description',
  'posSettings.c_sound_feedback_t': 'Sounds and feedback',
  'posSettings.c_sound_feedback_d': 'Configure barcode scan, alert, and payment sounds, volume, and vibration.',
  'posSettings.c_shifts_t': 'POS shifts',
  'posSettings.c_shifts_d': 'Shifts description',
  'posSettings.c_devices_t': 'POS devices',
  'posSettings.c_devices_d': 'Devices description',
  'posSettings.c_printing_t': 'Receipts and printing',
  'posSettings.c_printing_d': 'Printing description',
  'posSettings.c_desktop_t': 'Desktop app',
  'posSettings.c_desktop_d': 'Desktop description',
  'nav.soon': 'Soon',
};

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => strings[`${namespace}.${key}`] ?? key,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

describe('مركز إعدادات POS', () => {
  afterEach(cleanup);

  it('يعرض بطاقة الأصوات والتنبيهات كمسار مستقل بجانب بطاقات الإعداد الحالية', () => {
    render(<PosSettingsPage />);

    const card = screen.getByRole('link', { name: /Sounds and feedback/i });
    expect(card.getAttribute('href')).toBe('/pos/settings/sound-feedback');
    expect(card.textContent).toContain('Configure barcode scan, alert, and payment sounds, volume, and vibration.');
  });
});
