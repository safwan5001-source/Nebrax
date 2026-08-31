// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EInvoiceSettingsPage from './page';

const { api, success, translate } = vi.hoisted(() => ({
  api: vi.fn(),
  success: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => translate,
  useLocale: () => 'en',
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success }) }));

const settings = {
  data: { submission_mode: 'manual', active_environment: 'developer' },
  meta: {
    signing_readiness: {
      ready: true,
      environment: 'developer',
      credential_stage: 'compliance',
      blockers: [],
    },
    transport_readiness: {
      ready: false,
      enabled: false,
      environment: 'developer',
      queue_connection: 'sync',
      blockers: ['dispatch_disabled', 'unsafe_queue_connection'],
    },
  },
};

const developerCredential = {
  id: 'credential-1',
  environment: 'developer',
  stage: 'compliance',
  status: 'configured',
  has_binary_security_token: true,
  has_secret: true,
  has_private_key: true,
  has_request_id: true,
  public_key_curve: 'secp256k1',
  certificate_chain_length: 2,
  certificate_fingerprint: 'AA:BB:CC',
  configured_at: '2026-08-25T08:00:00Z',
  expires_at: '2027-08-25T08:00:00Z',
  updated_at: '2026-08-25T08:00:00Z',
};

function installApi() {
  api.mockImplementation((path: string, options?: { method?: string }) => {
    if (path === '/applications/nav-state') return Promise.resolve({ data: { 'compliance.zatca': true } });
    if (path === '/zatca-settings') return Promise.resolve(settings);
    if (path === '/zatca-credentials') return Promise.resolve({ data: [developerCredential] });
    if (path.startsWith('/zatca-credentials/') && options?.method === 'PUT') return Promise.resolve({ data: developerCredential });
    return Promise.reject(new Error(`Unexpected API call: ${path}`));
  });
}

describe('ZATCA connection workspace', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
    success.mockReset();
    installApi();
  });

  it('shows backend readiness blockers and keeps automatic submission unavailable', async () => {
    render(<EInvoiceSettingsPage />);

    expect(await screen.findByText('zatca_connection.credentials_title')).toBeTruthy();
    expect(screen.getByText(/zatca_connection\.blockers\.dispatch_disabled/)).toBeTruthy();
    expect(screen.getByText(/zatca_connection\.blockers\.unsafe_queue_connection/)).toBeTruthy();

    const submissionMode = screen.getByLabelText('zatca_submission_mode') as HTMLSelectElement;
    const automatic = Array.from(submissionMode.options).find((option) => option.value === 'automatic');
    expect(automatic?.disabled).toBe(true);
  });

  it('never fills secret inputs from credential metadata and only submits changed secret values', async () => {
    const user = userEvent.setup();
    render(<EInvoiceSettingsPage />);
    await screen.findByText('zatca_connection.credential_summary');

    const token = screen.getByLabelText('zatca_connection.binary_security_token') as HTMLTextAreaElement;
    const privateKey = screen.getByLabelText('zatca_connection.private_key') as HTMLTextAreaElement;
    const secret = screen.getByLabelText('zatca_connection.secret') as HTMLInputElement;
    expect(token.value).toBe('');
    expect(privateKey.value).toBe('');
    expect(secret.value).toBe('');

    await user.type(secret, 'replacement-secret');
    await user.type(screen.getByLabelText('zatca_connection.current_password'), 'current-password');
    await user.click(screen.getByRole('button', { name: 'zatca_connection.update_credential' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/zatca-credentials/developer', {
      method: 'PUT',
      body: {
        stage: 'compliance',
        current_password: 'current-password',
        secret: 'replacement-secret',
      },
    }));
    expect(success).toHaveBeenCalledWith('zatca_connection.credential_saved');
  });

  it('requires explicit confirmation before production credentials can be saved', async () => {
    const user = userEvent.setup();
    render(<EInvoiceSettingsPage />);
    await screen.findByText('zatca_connection.credentials_title');

    await user.click(screen.getByRole('tab', { name: 'zatca_environment_production' }));
    const save = screen.getByRole('button', { name: 'zatca_connection.configure_credential' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByText('zatca_connection.production_confirmation'));
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});
