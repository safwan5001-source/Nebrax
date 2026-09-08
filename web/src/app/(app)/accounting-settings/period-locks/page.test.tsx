// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountingPeriodLocksPage from './page';

/**
 * ACC-6 P2-2: عمود «أنشأه» يعرض وقت الحدث لا تاريخه فقط — سلوكٌ يهمّ خصوصاً
 * حين يقع الإنشاء والتحرير في اليوم نفسه. `formatDateTime` من `@/lib/formatting`
 * **غير مُصطنَع** في هذا الاختبار عمداً: نريد إثبات المخرَج الحقيقي، لا افتراض
 * أنه استُدعي.
 */
/**
 * الترجمتان `t`/`tc` مراجع **ثابتتان** عبر كل استدعاء لـ`useTranslations` —
 * لا دوالّ جديدة كل تصيير. `load()` مبني على `useCallback([t])`، فمرجعٌ متغيّر
 * لـ`t` كان يعيد إنشاء `load` كل تصيير ويُعيد تشغيل الأثر الذي يستدعيه
 * لا نهائياً، فيستهلك طابور `mockResolvedValueOnce` قبل أن يقرأه أي اختبار.
 */
const { api, currentUser, toastSuccess, toastError, t, tc } = vi.hoisted(() => {
  const accountingSettingsStrings: Record<string, string> = {
    forbidden: 'Forbidden',
    forbiddenHint: 'Forbidden hint',
    periodLocksTitle: 'Accounting Period Locks',
    periodLocksSubtitle: 'Subtitle',
    periodLocksDraftNotice: 'Draft notice',
    backToAccountingSettings: 'Back',
    locksViewOnly: 'View only',
    loadFailed: 'Load failed',
    locksEmpty: 'No locks',
    locksEmptyHint: 'No locks hint',
    locksTableTitle: 'Ranges',
    lockRange: 'Range',
    lockStatusColumn: 'Status',
    lockReason: 'Reason',
    lockCreatedBy: 'Created by',
    lockReleasedBy: 'Released by',
    lockActionsColumn: 'Actions',
    lockStatusActive: 'Locked',
    lockStatusReleased: 'Released',
    lockCreateAction: 'Lock a period',
    lockHistoryAction: 'Audit trail',
    lockReleaseAction: 'Release lock',
  };
  const commonStrings: Record<string, string> = { cancel: 'Cancel', save: 'Save' };
  return {
    api: vi.fn(),
    currentUser: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    t: (key: string) => accountingSettingsStrings[key] ?? key,
    tc: (key: string) => commonStrings[key] ?? key,
  };
});

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (namespace === 'common' ? tc : t),
  useLocale: () => 'en',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: toastSuccess, error: toastError }) }));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

const OLD_SLICED_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccountingPeriodLocksPage — audit timestamp display', () => {
  it('shows created/released timestamps with a time component, not date-only', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: undefined });
    api.mockResolvedValueOnce({
      data: {
        locks: [
          {
            id: 'lock-1',
            start_date: '2026-01-01',
            end_date: '2026-01-31',
            status: 'released',
            reason: 'January close',
            created_by: 'Owner',
            created_at: '2026-01-15T09:05:00Z',
            released_by: 'Owner',
            released_at: '2026-01-15T16:45:00Z',
            release_reason: 'Reopen for correction',
          },
        ],
      },
    });

    render(<AccountingPeriodLocksPage />);

    await waitFor(() => screen.getByText('Ranges'));

    // كلا الطابعين يقعان في خليتَي «أنشأه»/«حرّره» — يُعرَّفان بمن نُسب إليهما
    // العمل («Owner» في العيّنة)، فلا تلتبسان بشارة الحالة («Released»)
    // التي تحمل نفس صنف `text-xs` من مكوّن `Badge`.
    const ownerCells = Array.from(document.querySelectorAll('td')).filter((td) => td.textContent?.includes('Owner'));
    expect(ownerCells).toHaveLength(2);

    const rendered = ownerCells.map((td) => td.querySelector('span')?.textContent ?? '');
    rendered.forEach((text) => {
      // الشكل القديم `value.slice(0, 10)` كان يُنتج تاريخاً عاريًا فقط.
      expect(text).not.toMatch(OLD_SLICED_FORMAT);
      // منسّق `formatDateTime` الحقيقي يضمّ فاصل وقت (`:`) دائماً.
      expect(text).toContain(':');
    });

    // الحدثان وقعا في اليوم نفسه بوقتين مختلفين، فيجب ألّا يتطابق نصّاهما.
    expect(rendered[0]).not.toBe(rendered[1]);
  });

  it('shows the audit trail dialog timestamp with a time component too', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: undefined });
    api.mockResolvedValueOnce({
      data: {
        locks: [
          {
            id: 'lock-1',
            start_date: '2026-01-01',
            end_date: '2026-01-31',
            status: 'active',
            reason: 'January close',
            created_by: 'Owner',
            created_at: '2026-01-15T09:05:00Z',
            released_by: null,
            released_at: null,
            release_reason: null,
          },
        ],
      },
    });
    api.mockResolvedValueOnce({
      data: [
        {
          id: 'event-1',
          lock_id: 'lock-1',
          action: 'lock_created',
          actor: 'Owner',
          start_date: '2026-01-01',
          end_date: '2026-01-31',
          reason: 'January close',
          created_at: '2026-01-15T09:05:00Z',
        },
      ],
    });

    render(<AccountingPeriodLocksPage />);

    await waitFor(() => screen.getByText('Ranges'));
    screen.getByLabelText('Audit trail').click();

    await waitFor(() => screen.getByText('January close'));
    // نطاق الحدث (`start_date — end_date`) يحمل صنف `font-mono` أيضاً؛ طابع
    // الوقت وحده بلا `font-mono` — `:not()` يفرّق بينهما بدقة.
    const eventTimestamp = document.querySelector('li span.text-xs.text-muted:not(.font-mono)');
    expect(eventTimestamp?.textContent).not.toMatch(OLD_SLICED_FORMAT);
    expect(eventTimestamp?.textContent).toContain(':');
  });
});
