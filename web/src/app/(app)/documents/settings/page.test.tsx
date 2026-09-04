// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DocumentSettingsPage from './page';

const { api, translate, ApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  const makeTranslator = (namespace: string) => {
    const fn = (key: string, values?: Record<string, unknown>) =>
      values && Object.keys(values).length > 0 ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`;
    return Object.assign(fn, { raw: () => ({}), rich: (key: string) => key });
  };

  return {
    api: vi.fn(),
    ApiError: MockApiError,
    translate: {
      documentCenterReview: makeTranslator('documentCenterReview'),
      documentOperations: makeTranslator('documentOperations'),
    },
  };
});

vi.mock('@/lib/api', () => ({
  api,
  ApiError,
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) =>
    translate[namespace as keyof typeof translate] ?? ((key: string) => key),
}));

vi.mock('@/components/documents/document-operations-nav', () => ({
  DocumentOperationsNav: () => <nav aria-label="document-operations">nav</nav>,
}));

vi.mock('@/components/documents/document-intelligence-settings', () => ({
  DocumentIntelligenceSettings: () => <div>intelligence-settings</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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

const governancePayload = {
  data: {
    policy: {
      retention_days: 90,
      enabled: true,
      purge_mode: 'soft',
      policy_source: 'platform_policy',
      last_run_at: null,
    },
    extraction_readiness: {
      provider_network_locked: true,
      platform_engine_enabled: false,
      primary_provider_ready: false,
      queue_async: false,
      ready: false,
    },
  },
};

const readyGovernancePayload = {
  data: {
    policy: {
      retention_days: 365,
      enabled: true,
      purge_mode: 'manual_governed',
      policy_source: 'config_default',
      last_run_at: null,
    },
    extraction_readiness: {
      provider_network_locked: false,
      platform_engine_enabled: true,
      primary_provider_ready: true,
      queue_async: true,
      ready: true,
    },
  },
};

describe('DocumentSettingsPage permissions', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders governance when operations returns 403 without settings-only role losing the page', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/document-governance') return Promise.resolve(governancePayload);
      if (path.startsWith('/document-operations')) {
        return Promise.reject(new ApiError(403, 'Forbidden'));
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<DocumentSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('documentCenterReview.retentionStatus')).toBeTruthy();
    });
    expect(screen.queryByText('documentCenterReview.loadFailed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'documentCenterReview.retry' })).toBeNull();
    expect(screen.getByText(/documentOperations.retentionDays/)).toBeTruthy();
  });

  it('shows load error when governance fails even if operations would succeed', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/document-governance') {
        return Promise.reject(new ApiError(500, 'Governance unavailable'));
      }
      if (path.startsWith('/document-operations')) {
        return Promise.resolve({ data: { summary: {}, retention: { retention_days: 30, enabled: false, purge_mode: 'soft' } } });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<DocumentSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Governance unavailable')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'documentCenterReview.retry' })).toBeTruthy();
  });

  it('binds network and extraction status from extraction_readiness instead of hardcoded locked copy', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/document-governance') return Promise.resolve(readyGovernancePayload);
      if (path.startsWith('/document-operations')) {
        return Promise.resolve({ data: { summary: {}, retention: { retention_days: 365, enabled: true, purge_mode: 'manual_governed' } } });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<DocumentSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('documentOperations.networkOpen')).toBeTruthy();
    });
    expect(screen.getByText('documentOperations.statusExtractionAvailable')).toBeTruthy();
    expect(screen.queryByText('documentOperations.networkLocked')).toBeNull();
    expect(screen.queryByText('documentOperations.statusExtractionUnavailable')).toBeNull();
    expect(screen.queryByText('documentCenterReview.providerNetworkLocked')).toBeNull();
  });

  it('keeps both timed-retention badges aligned with governance.policy.enabled', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/document-governance') return Promise.resolve(governancePayload);
      if (path.startsWith('/document-operations')) {
        return Promise.reject(new ApiError(403, 'Forbidden'));
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<DocumentSettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByText('documentOperations.retentionEnabled').length).toBe(2);
    });
    expect(screen.queryByText('documentOperations.retentionDisabled')).toBeNull();
  });
});
