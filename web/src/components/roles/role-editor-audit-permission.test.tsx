// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import type { CatalogLabels, RoleRecord } from '@/modules/roles/catalog';
import { RoleEditorSheet } from './role-editor-sheet';

const { api, toast, FakeApiError } = vi.hoisted(() => ({
  api: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  FakeApiError: class FakeApiError extends Error {},
}));

vi.mock('@/lib/api', () => ({ api, ApiError: FakeApiError }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

/**
 * INT-UX-6 / PR-6a — المفتاح الجديد يظهر في محرر الأدوار الحقيقي من الكتالوج، بتسميات المنتج الفعلية (عربي/إنجليزي)،
 * ويُعدّ صلاحية حساسة من فئة «data»، ويُرسَل حرفياً دون وراثة من `view` أو إلى `manage`/`reassign`.
 */
const KEY = 'delivery_connector.audit.view';
const CATALOG = ['products.view', 'delivery_connector.view', 'delivery_connector.manage', 'delivery_connector.reassign', KEY];
const pick = (all: Record<string, unknown>) => ({ roleEditor: all.roleEditor, common: all.common });

const labelsOf = (locale: 'en' | 'ar'): CatalogLabels => {
  const hr = (locale === 'en' ? enMessages : arMessages).hr as unknown as { perm_modules: Record<string, string>; perm_actions: Record<string, string>; perm_areas: Record<string, string> };
  return { modules: hr.perm_modules, actions: hr.perm_actions, areas: hr.perm_areas };
};

function open(locale: 'en' | 'ar', role: RoleRecord | null = null) {
  const all = (locale === 'en' ? enMessages : arMessages) as unknown as Record<string, unknown>;
  return render(
    <NextIntlClientProvider locale={locale} messages={pick(all) as never}>
      <RoleEditorSheet open onClose={() => {}} onSaved={() => {}} role={role} catalog={CATALOG} labels={labelsOf(locale)} actorPermissions={['*']} />
    </NextIntlClientProvider>,
  );
}

const SCOPE = { en: 'Delivery connectors', ar: 'موصّلات التوصيل' } as const;
const AUDIT = { en: /Audit — View/, ar: /التدقيق — عرض/ } as const;
const box = (locale: 'en' | 'ar', name: RegExp | string) => within(screen.getByRole('region', { name: SCOPE[locale] })).getByRole('checkbox', { name }) as HTMLInputElement;
const lastBody = () => (api.mock.calls.at(-1)?.[1] as { body: { name: string; permissions: string[] } }).body;

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ data: { id: 'new-id' } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each(['en', 'ar'] as const)('role editor — audit permission (%s)', (locale) => {
  it('lists the key with its own label, unchecked by default, next to — and distinct from — the other connector permissions', () => {
    open(locale);
    const region = within(screen.getByRole('region', { name: SCOPE[locale] }));
    // أربع صلاحيات للوحدة + مفتاح «تحديد الوحدة كلها» الجماعي.
    expect(region.getAllByRole('checkbox')).toHaveLength(5);
    expect(box(locale, AUDIT[locale]).checked).toBe(false);
    for (const checkbox of region.getAllByRole('checkbox') as HTMLInputElement[]) expect(checkbox.checked).toBe(false);
    // وهي الأربع المتمايزة بالاسم: «التدقيق — عرض» لا تلتبس بـ«عرض» العادية.
    const labels = labelsOf(locale);
    expect(region.getByRole('checkbox', { name: new RegExp(`^${labels.actions.view}$`) })).toBeTruthy();
    expect(region.getByRole('checkbox', { name: AUDIT[locale] })).toBeTruthy();
  });

  it('ticking it selects only itself (no inheritance either way), counts it as sensitive, and sends the exact key', async () => {
    open(locale);
    const name = locale === 'en' ? 'Role name' : 'اسم الدور';
    await userEvent.type(screen.getByLabelText(name), 'Auditor');
    await userEvent.click(box(locale, AUDIT[locale]));

    const region = within(screen.getByRole('region', { name: SCOPE[locale] }));
    const checked = (region.getAllByRole('checkbox') as HTMLInputElement[]).filter((c) => c.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]).toBe(box(locale, AUDIT[locale]));

    const roleEditor = (locale === 'en' ? enMessages : arMessages).roleEditor as Record<string, string>;
    expect(await screen.findAllByText(new RegExp(roleEditor.risk_data.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).not.toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Save' : (arMessages.common as Record<string, string>).save }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(lastBody().permissions).toEqual([KEY]);
  });

  it('ticking a sibling never ticks the audit key, and a role stored with the three siblings shows the audit box unchecked', () => {
    const legacy: RoleRecord = { id: 'r1', slug: 'old', name: 'Old', permissions: ['delivery_connector.view', 'delivery_connector.manage', 'delivery_connector.reassign'], is_system: false, is_owner: false, users_count: 1 };
    open(locale, legacy);
    expect(box(locale, AUDIT[locale]).checked).toBe(false);
    const region = within(screen.getByRole('region', { name: SCOPE[locale] }));
    expect((region.getAllByRole('checkbox') as HTMLInputElement[]).filter((c) => c.checked)).toHaveLength(3);
  });
});
