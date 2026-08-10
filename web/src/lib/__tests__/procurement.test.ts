import { describe, expect, it } from 'vitest';
import {
  NEXT_STATUSES,
  NEXT_TARGETS,
  PROCUREMENT_ROUTE,
  REQUIRES_SUPPLIER,
  canConvert,
  isClosed,
  statusTone,
  type ProcurementStatus,
  type ProcurementType,
} from '../procurement';

const TYPES: ProcurementType[] = ['request', 'rfq', 'quotation', 'order'];

/**
 * ثوابت دورة الشراء. قيمتها أنها **مرآة** لما يفرضه `ProcurementService`:
 * أي انحراف يعني زرّاً يَعِد بما يرفضه الخادم بـ 422.
 */
describe('ثوابت دورة الشراء', () => {
  it('لكل نوع مسار شاشة مستقلّ', () => {
    const routes = TYPES.map((t) => PROCUREMENT_ROUTE[t]);
    expect(routes).toHaveLength(4);
    expect(new Set(routes).size).toBe(4);
  });

  it('السلسلة اتجاهها واحد وتنتهي بفاتورة المشتريات', () => {
    expect(NEXT_TARGETS.request).toContain('rfq');
    expect(NEXT_TARGETS.rfq).toEqual(['quotation']);
    expect(NEXT_TARGETS.quotation).toEqual(['order']);
    expect(NEXT_TARGETS.order).toEqual(['purchase']);
    // لا يعود أيّ نوع إلى ما قبله
    expect(NEXT_TARGETS.order).not.toContain('request');
    expect(NEXT_TARGETS.quotation).not.toContain('rfq');
  });

  it('الشراء الصغير يقفز من الطلب إلى الأمر مباشرةً', () => {
    expect(NEXT_TARGETS.request).toContain('order');
  });

  it('العرض والأمر وحدهما يلزمهما مورّد', () => {
    expect(REQUIRES_SUPPLIER).toEqual(['quotation', 'order']);
  });

  it('التحويل للمعتمَد وحده', () => {
    expect(canConvert('approved')).toBe(true);
    (['draft', 'submitted', 'rejected', 'converted', 'cancelled'] as ProcurementStatus[])
      .forEach((s) => expect(canConvert(s)).toBe(false));
  });

  it('الحالتان النهائيتان لا انتقال بعدهما', () => {
    expect(isClosed('converted')).toBe(true);
    expect(isClosed('cancelled')).toBe(true);
    expect(NEXT_STATUSES.converted).toEqual([]);
    expect(NEXT_STATUSES.cancelled).toEqual([]);
  });

  it('لا يُعتمد مستند لم يُرسَل', () => {
    expect(NEXT_STATUSES.draft).not.toContain('approved');
    expect(NEXT_STATUSES.submitted).toContain('approved');
  });

  it('«مُحوَّل» لا يُدرَج انتقالاً يدوياً في أي حالة', () => {
    Object.values(NEXT_STATUSES).forEach((next) => expect(next).not.toContain('converted'));
  });

  it('لون الشارة يميّز الناجح من المرفوض', () => {
    expect(statusTone('approved')).toBe('positive');
    expect(statusTone('converted')).toBe('positive');
    expect(statusTone('rejected')).toBe('negative');
    expect(statusTone('cancelled')).toBe('negative');
    expect(statusTone('draft')).toBe('muted');
  });
});
