// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { DocumentIntelligenceSettings } from './document-intelligence-settings';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const payload = {
  data: {
    settings: {
      processing_enabled: true,
      allowed_document_types: ['delivery_note'],
      retention_mode: 'document_center_only',
      retains_original_in_document_center: true,
      attaches_original_to_record: false,
    },
    available_document_types: [
      'purchase_invoice',
      'sales_invoice',
      'expense',
      'delivery_note',
      'receipt',
      'credit_note',
      'debit_note',
    ],
    available_retention_modes: [
      'document_center_only',
      'record_attachment_only',
      'document_center_and_attachment',
      'do_not_retain',
    ],
  },
};

describe('DocumentIntelligenceSettings type labels', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each<[TestLocale, string]>([
    ['ar', TEST_MESSAGES.ar.documentCenterIntake.typeDeliveryNote],
    ['en', TEST_MESSAGES.en.documentCenterIntake.typeDeliveryNote],
  ])('renders %s delivery-note label from documentCenterIntake, not a raw i18n path', async (locale, expected) => {
    api.mockResolvedValue(payload);
    renderIntl(<DocumentIntelligenceSettings />, locale);

    await waitFor(() => {
      expect(screen.getByText(expected)).toBeTruthy();
    });
    expect(screen.queryByText('documentCenterReview.typeDeliveryNote')).toBeNull();
    expect(screen.queryByText('documentCenterIntake.typeDeliveryNote')).toBeNull();
  });
});
