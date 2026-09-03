/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceTemplateSelector } from './invoice-template-selector';

const { api, translate, locale } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    design_label: 'Invoice design',
    design_default_badge: 'Default',
    design_custom_badge: 'Custom for this invoice',
    design_change: 'Change design',
    design_reset: 'Reset to default',
    design_preview: 'Preview',
    design_preview_title: 'Design preview',
    design_preview_hint: 'Sample preview, not this invoice.',
    design_picker_title: 'Choose invoice design',
    design_safe_default: 'Safe default design',
    design_loading: 'Loading designs…',
    design_load_error: 'Could not load designs.',
    design_empty: 'No published designs.',
    design_incompatible: 'Selected design does not match the ZATCA type.',
  };
  const translator = Object.assign(
    (key: string) => strings[key] ?? key,
    { raw: () => ({}), rich: (key: string) => strings[key] ?? key },
  );
  const locale = { current: 'en' };
  return { api: vi.fn(), translate: translator, locale };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => locale.current }));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/branch', () => ({
  getActiveBranchId: () => 'br-1',
  BRANCH_CHANGED_EVENT: 'nibras:branch-changed',
}));
vi.mock('@/modules/documents/components/document-view', () => ({
  DocumentView: () => <div data-testid="document-view" />,
}));
vi.mock('@/modules/documents/components/document-scaler', () => ({
  DocumentScaler: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

const classic = {
  id: 'tpl-classic',
  name: 'Classic A4',
  document_types: ['tax_invoice'],
  published_revision_id: 'rev-classic',
  published_revision: {
    id: 'rev-classic',
    status: 'published',
    document_types: ['tax_invoice'],
    definition: { template_id: 'tax-invoice-classic', theme_id: 'blue' },
  },
};
const modern = {
  id: 'tpl-modern',
  name: 'Modern A4',
  document_types: ['tax_invoice'],
  published_revision_id: 'rev-modern',
  published_revision: {
    id: 'rev-modern',
    status: 'published',
    document_types: ['tax_invoice'],
    definition: { template_id: 'tax-invoice-modern', theme_id: 'violet' },
  },
};
const thermal = {
  id: 'tpl-thermal',
  name: 'Thermal 80',
  document_types: ['tax_invoice'],
  published_revision_id: 'rev-thermal',
  published_revision: {
    id: 'rev-thermal',
    status: 'published',
    document_types: ['tax_invoice'],
    definition: { template_id: 'tax-invoice-thermal80' },
  },
};
const quotation = {
  id: 'tpl-quote',
  name: 'Proposal',
  document_types: ['quotation'],
  published_revision_id: 'rev-quote',
  published_revision: {
    id: 'rev-quote',
    status: 'published',
    document_types: ['quotation'],
    definition: { template_id: 'quotation-proposal' },
  },
};

function mockLibrary(templates = [classic, modern, thermal, quotation], liveId = 'rev-classic') {
  api.mockImplementation((path: string) => {
    if (path.startsWith('/print-templates/resolve')) {
      return Promise.resolve({
        data: {
          print_template_revision_id: liveId,
          revision: classic.published_revision,
        },
      });
    }
    if (path.startsWith('/print-templates')) {
      return Promise.resolve({ data: templates });
    }
    return Promise.resolve({ data: [] });
  });
}

describe('InvoiceTemplateSelector', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockClear(); locale.current = 'en'; });

  it('shows the default badge while following the live assignment', async () => {
    mockLibrary();
    const onChange = vi.fn();
    render(
      <InvoiceTemplateSelector
        zatcaDocumentType="standard"
        overrideRevisionId={null}
        onChange={onChange}
      />,
    );
    expect(await screen.findByText('Classic A4')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.queryByText('Thermal 80')).toBeNull();
  });

  it('shows the custom badge and can reset', async () => {
    mockLibrary();
    const onChange = vi.fn();
    render(
      <InvoiceTemplateSelector
        zatcaDocumentType="standard"
        overrideRevisionId="rev-modern"
        onChange={onChange}
      />,
    );
    expect(await screen.findByText('Modern A4')).toBeTruthy();
    expect(screen.getByText('Custom for this invoice')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('opens the picker dialog without thermal or quotation templates', async () => {
    mockLibrary();
    render(
      <InvoiceTemplateSelector
        zatcaDocumentType="standard"
        overrideRevisionId={null}
        onChange={vi.fn()}
      />,
    );
    await screen.findByText('Classic A4');
    await userEvent.click(screen.getByRole('button', { name: 'Change design' }));
    expect(screen.getByRole('dialog', { name: 'Choose invoice design' })).toBeTruthy();
    expect(screen.getAllByText('Classic A4').length).toBeGreaterThan(0);
    expect(screen.getByText('Modern A4')).toBeTruthy();
    expect(screen.queryByText('Thermal 80')).toBeNull();
    expect(screen.queryByText('Proposal')).toBeNull();
  });

  it('selects a published template from the picker', async () => {
    mockLibrary();
    const onChange = vi.fn();
    render(
      <InvoiceTemplateSelector
        zatcaDocumentType="standard"
        overrideRevisionId={null}
        onChange={onChange}
      />,
    );
    await screen.findByText('Classic A4');
    await userEvent.click(screen.getByRole('button', { name: 'Change design' }));
    await userEvent.click(screen.getByRole('button', { name: /Modern A4/ }));
    expect(onChange).toHaveBeenCalledWith('rev-modern');
  });

  it('opens a sample preview dialog', async () => {
    mockLibrary();
    render(
      <InvoiceTemplateSelector
        zatcaDocumentType="standard"
        overrideRevisionId={null}
        onChange={vi.fn()}
      />,
    );
    await screen.findByText('Classic A4');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('dialog', { name: 'Design preview' })).toBeTruthy();
    expect(screen.getByText('Sample preview, not this invoice.')).toBeTruthy();
    expect(screen.getAllByTestId('document-view').length).toBeGreaterThan(0);
  });

  it('shows a load error without blocking the default path', async () => {
    api.mockRejectedValue(new Error('offline'));
    render(
      <InvoiceTemplateSelector
        zatcaDocumentType="standard"
        overrideRevisionId={null}
        onChange={vi.fn()}
      />,
    );
    expect(await screen.findByText('Could not load designs.')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
  });

  it('flags an incompatible saved override', async () => {
    mockLibrary();
    const onCompatibilityChange = vi.fn();
    render(
      <InvoiceTemplateSelector
        zatcaDocumentType="standard"
        overrideRevisionId="rev-thermal"
        onChange={vi.fn()}
        onCompatibilityChange={onCompatibilityChange}
      />,
    );
    expect(await screen.findByText('Selected design does not match the ZATCA type.')).toBeTruthy();
    await waitFor(() => expect(onCompatibilityChange).toHaveBeenCalledWith(false));
  });

  it('renders the compact row LTR in English and RTL in Arabic', async () => {
    mockLibrary();
    const { container, rerender } = render(
      <InvoiceTemplateSelector
        zatcaDocumentType="standard"
        overrideRevisionId={null}
        onChange={vi.fn()}
      />,
    );
    await screen.findByText('Classic A4');
    expect(container.querySelector('[dir="ltr"]')).toBeTruthy();

    locale.current = 'ar';
    rerender(
      <InvoiceTemplateSelector
        zatcaDocumentType="standard"
        overrideRevisionId={null}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
  });
});
