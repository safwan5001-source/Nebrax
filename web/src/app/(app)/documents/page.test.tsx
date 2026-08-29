// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DocumentsPage from './page';

const { api, currentUser } = vi.hoisted(() => ({
  api: vi.fn(),
  currentUser: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock('@/lib/auth', () => ({ currentUser }));

vi.mock('@/components/document-center/document-upload-dialog', () => ({
  DocumentUploadDialog: () => null,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), toast: vi.fn(), error: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => Object.assign(
    (key: string) => `${namespace}.${key}`,
    { raw: () => ({}), rich: (key: string) => key },
  ),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('@/components/documents/document-operations-nav', () => ({
  DocumentOperationsNav: () => <nav aria-label="document-operations">nav</nav>,
}));

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

describe('DocumentsPage intake entry', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('يعرض زر الرفع وCTA الفارغ لمن يملك صلاحية الإدارة', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: ['documents.center.manage', 'documents.center.view'] });
    api.mockResolvedValue({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } });

    render(<DocumentsPage />);

    expect((await screen.findAllByRole('button', { name: 'documentCenterIntake.upload' })).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText('documentCenterIntake.emptyTitle')).toBeTruthy();
    });
    expect(screen.getByLabelText('document-operations')).toBeTruthy();
  });

  it('يخفي زر الرفع من مستخدم العرض فقط', async () => {
    currentUser.mockReturnValue({ role: 'staff', permissions: ['documents.center.view'] });
    api.mockResolvedValue({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } });

    render(<DocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText('documentCenterIntake.emptyTitle')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'documentCenterIntake.upload' })).toBeNull();
  });
});
