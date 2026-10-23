import { describe, expect, it } from 'vitest';
import {
  partnerImportFormData,
  partnerJobOptions,
  partnerMappingGaps,
  spreadsheetSafe,
  suggestedPartnerMapping,
  type PartnerImportField,
} from './contract';

const field = (key: string, required = false, writable = true): PartnerImportField => ({
  key, label_ar: key, label_en: key, type: 'text', required, clearable: false, update_locked: false, writable,
});
const fields = [field('nebrax_id', false, false), field('code'), field('name', true)];

describe('partner import contract (IMP-H3-S3)', () => {
  it('create/upsert need the name; update/upsert need an identifier; one column per field', () => {
    expect(partnerMappingGaps({ 0: 'code' }, fields, 'create').missingRequired.map((f) => f.key)).toEqual(['name']);
    expect(partnerMappingGaps({ 0: 'name' }, fields, 'update').missingIdentifier).toBe(true);
    expect(partnerMappingGaps({ 0: 'name' }, fields, 'upsert').missingIdentifier).toBe(true);
    expect(partnerMappingGaps({ 0: 'name', 1: 'code' }, fields, 'upsert')).toEqual({ missingRequired: [], missingIdentifier: false, duplicate: false });
    expect(partnerMappingGaps({ 0: 'name', 1: 'name' }, fields, 'create').duplicate).toBe(true);
    // the name alone never identifies a row, even though it is required for create
    expect(partnerMappingGaps({ 0: 'name' }, fields, 'create').missingIdentifier).toBe(false);
  });

  it('sends the type, policies and an explicit "ignore" for unmatched columns', () => {
    const form = partnerImportFormData(new File(['x'], 'p.csv'), {
      type: 'supplier', mode: 'upsert', blankPolicy: 'clear', duplicateSignalPolicy: 'skip', mapping: { 0: 'code', 1: null },
    });
    expect(form.get('type')).toBe('supplier');
    expect([form.get('mode'), form.get('blank_policy'), form.get('duplicate_signal_policy')]).toEqual(['upsert', 'clear', 'skip']);
    expect([form.get('mapping[0]'), form.get('mapping[1]')]).toEqual(['code', 'ignore']);
  });

  it('sends no mapping when there is no inspection, and the job options mirror the preview options', () => {
    const options = { type: 'customer' as const, mode: 'create' as const, blankPolicy: 'ignore' as const, duplicateSignalPolicy: 'warn' as const };
    expect([...partnerImportFormData(new File(['x'], 'p.csv'), options).keys()].some((k) => k.startsWith('mapping'))).toBe(false);
    expect(partnerJobOptions(options)).toEqual({ type: 'customer', mode: 'create', blank_policy: 'ignore', duplicate_signal_policy: 'warn' });
    expect(partnerJobOptions({ ...options, mapping: { 0: 'name' } }).mapping).toEqual({ 0: 'name' });
  });

  it('suggested mapping follows the server and CSV cells neutralise formulas', () => {
    expect(suggestedPartnerMapping([{ index: 0, header: 'a', samples: [], suggested_field: 'name' }, { index: 1, header: 'b', samples: [], suggested_field: null }])).toEqual({ 0: 'name', 1: null });
    expect(['=SUM(A1)', '+1', '-1', '@x', 'plain'].map(spreadsheetSafe)).toEqual(["'=SUM(A1)", "'+1", "'-1", "'@x", 'plain']);
  });
});
