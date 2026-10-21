import { describe, expect, it } from 'vitest';
import {
  type ProductPreview,
  type PreviewRow,
  appliesChanges,
  approvalBlockReason,
  canSubmitApproval,
  errorCode,
  isStalePreviewCode,
  issueCounts,
  minorToRiyal,
  shortHash,
} from './product-preview';

const base: ProductPreview = {
  id: 'p1',
  action_id: 'a1',
  action_version: 3,
  status: 'active',
  invalidation_reason: null,
  preview_hash: 'a'.repeat(64),
  approvable: true,
  generated_at: null,
  expires_at: null,
  totals: { rows: 3, create: 1, update: 1, skip: 1, blocked: 0, errors: 0, warnings: 2, has_cost_values: true, images: 0 },
  issues: [],
  images: null,
  rows: [],
  pagination: { page: 1, per_page: 100, total: 3, last_page: 1, operation: null },
  approval: null,
  permissions: { can_view_cost: true, cost_hidden: false, can_approve: true },
};

describe('تحويل الهللات إلى ريال للعرض', () => {
  it('يحوّل بالأعداد الصحيحة بلا float', () => {
    expect(minorToRiyal(1050)).toBe('10.50');
    expect(minorToRiyal(5)).toBe('0.05');
    expect(minorToRiyal(0)).toBe('0.00');
    expect(minorToRiyal(10000000000001)).toBe('100000000000.01');
    expect(minorToRiyal(-250)).toBe('-2.50');
  });

  it('يرفض القيم غير الصحيحة بدل تخمينها', () => {
    expect(minorToRiyal(null)).toBeNull();
    expect(minorToRiyal(undefined)).toBeNull();
    expect(minorToRiyal(10.5)).toBeNull();
    expect(minorToRiyal(Number.NaN)).toBeNull();
  });
});

describe('حارس زر الموافقة', () => {
  it('يتطلب تأكيداً صريحاً ومعاينة صالحة وقابلة للموافقة وصلاحية', () => {
    expect(canSubmitApproval(base, true, false, false)).toBe(true);
    expect(canSubmitApproval(base, false, false, false)).toBe(false);
    expect(canSubmitApproval(base, true, true, false)).toBe(false);
    expect(canSubmitApproval(null, true, false, false)).toBe(false);
  });

  it('يمنع الموافقة مع تعديلات غير محفوظة أو معاينة مُبطلة أو منتهية أو بأخطاء أو بلا صلاحية', () => {
    expect(canSubmitApproval(base, true, false, true)).toBe(false);
    expect(canSubmitApproval({ ...base, status: 'invalidated' }, true, false, false)).toBe(false);
    expect(canSubmitApproval({ ...base, status: 'expired' }, true, false, false)).toBe(false);
    expect(canSubmitApproval({ ...base, approvable: false }, true, false, false)).toBe(false);
    expect(canSubmitApproval({ ...base, permissions: { ...base.permissions, can_approve: false } }, true, false, false)).toBe(false);
  });

  it('لا يسمح بموافقة ثانية على معاينة وُوفق عليها', () => {
    const approved = { ...base, approval: { id: 'x', preview_id: 'p1', action_version: 3, preview_hash: base.preview_hash, approved_by: 'u', approved_at: null, expires_at: null, revoked_at: null, revocation_reason: null, status: 'active' as const } };
    expect(canSubmitApproval(approved, true, false, false)).toBe(false);
    expect(approvalBlockReason(approved, false)).toBeNull();
  });

  it('يشرح سبب التعطيل بنص مفهوم', () => {
    expect(approvalBlockReason(base, true)).toMatch(/غير محفوظة/);
    expect(approvalBlockReason({ ...base, status: 'expired' }, false)).toMatch(/انتهت/);
    expect(approvalBlockReason({ ...base, approvable: false }, false)).toMatch(/أخطاء/);
    expect(approvalBlockReason({ ...base, permissions: { can_view_cost: false, cost_hidden: true, can_approve: false } }, false)).toMatch(/التكلفة/);
    expect(approvalBlockReason(base, false)).toBeNull();
  });
});

describe('رموز الأخطاء', () => {
  it('يستخرج رمز الخطأ من جسم الاستجابة ويصنّف المعاينات الباطلة', () => {
    expect(errorCode({ error: { code: 'preview_stale', message: 'x' } })).toBe('preview_stale');
    expect(errorCode({ message: 'x' })).toBeNull();
    expect(errorCode(null)).toBeNull();
    expect(isStalePreviewCode('preview_stale')).toBe(true);
    expect(isStalePreviewCode('version_conflict')).toBe(true);
    expect(isStalePreviewCode('permission_denied')).toBe(false);
    expect(isStalePreviewCode(null)).toBe(false);
  });
});

describe('ملخصات المعاينة', () => {
  it('يعدّ ما سيُطبَّق ويجمّع الملاحظات بالرمز مع الأخطاء أولاً', () => {
    expect(appliesChanges(base.totals)).toBe(2);
    const row = (issues: PreviewRow['issues']) => ({ issues }) as PreviewRow;
    const counts = issueCounts([
      row([{ code: 'tax_rate_missing', field: 'tax_rate', severity: 'warning', message: '' }]),
      row([{ code: 'tax_rate_missing', field: 'tax_rate', severity: 'warning', message: '' }, { code: 'required_missing', field: 'name', severity: 'error', message: '' }]),
    ]);
    expect(counts).toEqual([
      { code: 'required_missing', severity: 'error', count: 1 },
      { code: 'tax_rate_missing', severity: 'warning', count: 2 },
    ]);
  });

  it('يختصر البصمة للعرض فقط', () => {
    expect(shortHash('a'.repeat(64))).toBe('aaaaaaaa…aaaaaaaa');
    expect(shortHash('abc')).toBe('abc');
  });
});
