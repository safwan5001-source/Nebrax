// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { ToastProvider } from '@/components/ui/toast';

const listApiClients = vi.fn();
const createApiClient = vi.fn();
const revokeApiKey = vi.fn();
vi.mock('@/lib/developer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/developer')>('@/lib/developer');
  return {
    ...actual,
    listApiClients: () => listApiClients(),
    createApiClient: (body: unknown) => createApiClient(body),
    revokeApiKey: (...args: unknown[]) => revokeApiKey(...args),
  };
});

import { KeysWorkspace } from '@/components/developer/keys/keys-workspace';

const CLIENT = {
  id: 'client-1', name: 'CI integration', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  keys: [{ id: 7, name: 'default', scopes: ['partners:read'], last_used_at: null, expires_at: null, created_at: '2026-01-01T00:00:00Z' }],
};
const SECRET = 'awjkey_ONE_TIME_ONLY_9999';

function renderWorkspace(canManage = true) {
  return renderIntl(<ToastProvider><KeysWorkspace canManage={canManage} /></ToastProvider>, 'en');
}

describe('API keys workspace', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('lists clients and their keys without exposing a hash or secret', async () => {
    listApiClients.mockResolvedValue([CLIENT]);
    const { container } = renderWorkspace();
    expect(await screen.findByText('CI integration')).toBeTruthy();
    expect(screen.getByText('partners:read')).toBeTruthy();
    // لا تجزئة ولا حقل توكن في القراءة
    expect(container.textContent).not.toMatch(/"token"|hash/i);
  });

  it('shows the created secret exactly once, then clears it after confirmation', async () => {
    listApiClients.mockResolvedValue([]);
    createApiClient.mockResolvedValue({ secret: SECRET, key: CLIENT.keys[0], client: CLIENT });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderWorkspace();

    // فتح حوار الإنشاء
    fireEvent.click(await screen.findByRole('button', { name: /Create API key/i }));
    // اسم + نطاق
    fireEvent.change(screen.getByLabelText(/Client name/i), { target: { value: 'CI' } });
    fireEvent.click(screen.getByText('partners:read'));
    // إرسال
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    // يظهر السرّ مرّة واحدة (بعد الكشف)
    await waitFor(() => expect(createApiClient).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /reveal|إظهار/i }));
    expect(screen.getByText(SECRET)).toBeTruthy();

    // لا تخزين دائم للسرّ
    for (const call of setItem.mock.calls) expect(String(call[1])).not.toContain(SECRET);

    // تأكيد ثم إغلاق ⇒ يختفي السرّ تماماً
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /I've saved the secret|حفظتُ السرّ/i }));
    await waitFor(() => expect(screen.queryByText(SECRET)).toBeNull());
  });

  it('hides mutating actions from a view-only user', async () => {
    listApiClients.mockResolvedValue([CLIENT]);
    renderWorkspace(false);
    await screen.findByText('CI integration');
    expect(screen.queryByRole('button', { name: /Create API key/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revoke/i })).toBeNull();
  });
});
