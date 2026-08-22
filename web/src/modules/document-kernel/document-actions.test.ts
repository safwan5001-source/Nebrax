import { describe, expect, it } from 'vitest';
import {
  availableDocumentActions,
  canDocumentAction,
  validateUiDocumentDescriptor,
  type DocumentActionCapabilities,
  type UiDocumentDescriptor,
} from './document-actions';

function capabilities(enabled: readonly (keyof DocumentActionCapabilities)[] = []): DocumentActionCapabilities {
  return Object.fromEntries(
    [
      'create', 'edit', 'issue', 'confirm', 'reverse', 'print', 'pdf', 'share',
      'xlsx', 'csv', 'ledger', 'template', 'export_profile',
    ].map((action) => [action, enabled.includes(action)]),
  ) as DocumentActionCapabilities;
}

describe('UI document descriptor', () => {
  it('keeps invoice actions explicit and ordered by the shared contract', () => {
    const descriptor: UiDocumentDescriptor = {
      family: 'line_item',
      kind: 'tax_invoice',
      lifecycle: 'operational',
      status: 'draft',
      capabilities: capabilities(['edit', 'issue', 'print', 'pdf', 'template']),
    };

    expect(validateUiDocumentDescriptor(descriptor)).toEqual([]);
    expect(availableDocumentActions(descriptor)).toEqual(['edit', 'issue', 'print', 'pdf', 'template']);
    expect(canDocumentAction(descriptor, 'ledger')).toBe(false);
  });

  it('permits report exports without inventing operational actions or a status', () => {
    const descriptor: UiDocumentDescriptor = {
      family: 'tabular_report',
      kind: 'customer_statement',
      lifecycle: 'derived',
      status: null,
      capabilities: capabilities(['print', 'pdf', 'xlsx', 'csv', 'export_profile']),
    };

    expect(validateUiDocumentDescriptor(descriptor)).toEqual([]);
    expect(availableDocumentActions(descriptor)).toEqual(['print', 'pdf', 'xlsx', 'csv', 'export_profile']);
    expect(canDocumentAction(descriptor, 'issue')).toBe(false);
  });

  it('rejects a report descriptor that promises a source-document action', () => {
    const descriptor: UiDocumentDescriptor = {
      family: 'account_statement',
      kind: 'partner_statement',
      lifecycle: 'derived',
      status: null,
      capabilities: capabilities(['print', 'pdf', 'issue']),
    };

    expect(validateUiDocumentDescriptor(descriptor)).toEqual(['derived_document_forbids_action:issue']);
  });

  it('rejects an operational document without a source status', () => {
    const descriptor: UiDocumentDescriptor = {
      family: 'voucher',
      kind: 'receipt_voucher',
      lifecycle: 'operational',
      status: null,
      capabilities: capabilities(['confirm', 'print']),
    };

    expect(validateUiDocumentDescriptor(descriptor)).toEqual(['operational_document_requires_status']);
  });
});
