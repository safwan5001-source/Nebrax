// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DocumentsPage from './page';

const { api, currentUser, translate, searchParams } = vi.hoisted(() => {
  const makeTranslator = (namespace: string) => {
    const fn = (key: string) => `${namespace}.${key}`;
    return Object.assign(fn, { raw: () => ({}), rich: (key: string) => key });
  };

  return {
    api: vi.fn(),
    currentUser: vi.fn(),
    searchParams: new URLSearchParams(),
    translate: {
      documentCenterReview: makeTranslator('documentCenterReview'),
      documentCenterIntake: makeTranslator('documentCenterIntake'),
    },
  };
});

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
  useTranslations: (namespace: string) =>
    translate[namespace as keyof typeof translate] ?? ((key: string) => key),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/components/document-center/document-batch-filters-dialog', () => ({
  DocumentBatchFiltersDialog: () => null,
}));

vi.mock('@/components/document-center/bulk-reviewer-dialog', () => ({
  BulkReviewerDialog: () => null,
}));

vi.mock('@/components/documents/document-operations-nav', () => ({
  DocumentOperationsNav: () => <nav aria-label="document-operations">nav</nav>,
}));

vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button type="button" {...props}>{children}</button> }));
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>, CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));

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

function mockListResponse() {
  api.mockImplementation((path: string) => {
    if (path === '/document-batches/eligible-reviewers') {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } });
  });
}

describe('DocumentsPage intake entry', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('يعرض زر الرفع وCTA الفارغ لمن يملك صلاحية الإدارة', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: ['documents.center.manage', 'documents.center.view'] });
    mockListResponse();

    render(<DocumentsPage />);

    expect((await screen.findAllByRole('button', { name: 'documentCenterIntake.upload' })).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText('documentCenterIntake.emptyTitle')).toBeTruthy();
    });
    expect(screen.getByLabelText('document-operations')).toBeTruthy();
  });

  it('يخفي زر الرفع من مستخدم العرض فقط', async () => {
    currentUser.mockReturnValue({ role: 'staff', permissions: ['documents.center.view'] });
    mockListResponse();

    render(<DocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText('documentCenterIntake.emptyTitle')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'documentCenterIntake.upload' })).toBeNull();
  });
});
