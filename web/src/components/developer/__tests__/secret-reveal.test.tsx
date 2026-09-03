// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { SecretRevealDialog } from '@/components/developer/secret-reveal';

const SECRET = 'awjkey_LIVE_SECRET_VALUE_1234567890';

describe('one-time secret reveal (security-critical)', () => {
  let setItem: ReturnType<typeof vi.spyOn>;
  let sessionSet: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // defineProperty يتجاوز getter-only clipboard الذي قد يثبّته اختبار سابق في الجولة الكاملة.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    setItem = vi.spyOn(Storage.prototype, 'setItem');
    sessionSet = vi.spyOn(window.sessionStorage, 'setItem');
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('masks the secret by default and reveals it on demand', () => {
    renderIntl(<SecretRevealDialog open title="Key" secret={SECRET} onClose={() => {}} />);
    // مقنّع: النصّ الصريح غير ظاهر ابتداءً
    expect(screen.queryByText(SECRET)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /reveal|إظهار/i }));
    expect(screen.getByText(SECRET)).toBeTruthy();
  });

  it('never writes the secret to localStorage or sessionStorage', () => {
    renderIntl(<SecretRevealDialog open title="Key" secret={SECRET} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /reveal|إظهار/i }));
    fireEvent.click(screen.getByRole('button', { name: /copy|نسخ/i }));
    // لا كتابة أي قيمة تحوي السرّ إلى أي تخزين دائم
    for (const call of setItem.mock.calls) expect(String(call[1])).not.toContain(SECRET);
    for (const call of sessionSet.mock.calls) expect(String(call[1])).not.toContain(SECRET);
  });

  it('copies the exact secret to the clipboard', () => {
    renderIntl(<SecretRevealDialog open title="Key" secret={SECRET} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy|نسخ/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SECRET);
  });

  it('requires explicit confirmation before it can be dismissed', () => {
    const onClose = vi.fn();
    renderIntl(<SecretRevealDialog open title="Key" secret={SECRET} onClose={onClose} />);
    const done = screen.getAllByRole('button').find((b) => (b as HTMLButtonElement).disabled) as HTMLButtonElement;
    expect(done).toBeTruthy(); // الزرّ مُعطَّل قبل التأكيد
    fireEvent.click(screen.getByRole('checkbox'));
    expect((done as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalled();
  });
});
