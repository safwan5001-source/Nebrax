import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  formatFileSize,
  intakeFileFormData,
  isAcceptedFile,
  statusesForGroup,
  workflowStatusGroup,
} from './intake-contract';

describe('intake-contract', () => {
  it('يبقي أنواع المستندات متطابقة مع StoreDocumentBatchRequest', () => {
    expect(DOCUMENT_TYPES).toEqual([
      'purchase_invoice',
      'sales_invoice',
      'expense',
      'delivery_note',
      'receipt',
      'credit_note',
      'debit_note',
    ]);
    expect(MAX_FILES_PER_BATCH).toBe(10);
    expect(MAX_FILE_BYTES).toBe(20_480 * 1024);
  });

  it('يبني FormData باسم الحقل file', () => {
    const file = new File(['x'], 'invoice.pdf', { type: 'application/pdf' });
    const form = intakeFileFormData(file);
    expect(form.get('file')).toBe(file);
  });

  it('يرفض الملفات الكبيرة أو ذات الامتداد غير المدعوم', () => {
    const ok = new File(['x'], 'scan.png', { type: 'image/png' });
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big.pdf', { type: 'application/pdf' });
    const bad = new File(['x'], 'notes.txt', { type: 'text/plain' });

    expect(isAcceptedFile(ok)).toBe(true);
    expect(isAcceptedFile(big)).toBe(false);
    expect(isAcceptedFile(bad)).toBe(false);
  });

  it('يصنّف حالات workflow إلى مجموعات الواجهة', () => {
    expect(workflowStatusGroup('received')).toBe('inbox');
    expect(workflowStatusGroup('needs_review')).toBe('review');
    expect(workflowStatusGroup('ready_for_draft')).toBe('ready');
    expect(workflowStatusGroup('draft_created')).toBe('completed');
    expect(workflowStatusGroup('reviewed')).toBe('completed');
    expect(workflowStatusGroup('failed')).toBe('terminal');
    expect(statusesForGroup('inbox')).toContain('processing');
    expect(statusesForGroup('completed')).toContain('reviewed');
    expect(statusesForGroup('ready')).not.toContain('reviewed');
  });

  it('يعرض أحجام الملفات بصيغة مقروءة', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
