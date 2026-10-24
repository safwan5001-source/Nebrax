import { describe, expect, it } from 'vitest';
import {
  spreadsheetSafe,
  suggestedTaxonomyMapping,
  taxonomyImportFormData,
  taxonomyJobOptions,
  taxonomyMappingGaps,
  type TaxonomyImportOptions,
} from './contract';

const category: TaxonomyImportOptions = { kind: 'category', mode: 'create', blankPolicy: 'ignore', parentPolicy: 'error' };

describe('taxonomy import contract (IMP-H4-S6a)', () => {
  it('create/upsert need the name column; update needs the name or the Nebrax ID; duplicates are flagged', () => {
    expect(taxonomyMappingGaps({ 0: 'description' }, 'create').missingName).toBe(true);
    expect(taxonomyMappingGaps({ 0: 'name' }, 'create')).toEqual({ missingName: false, missingIdentifier: false, duplicate: false });
    expect(taxonomyMappingGaps({ 0: 'description' }, 'upsert').missingName).toBe(true);
    expect(taxonomyMappingGaps({ 0: 'description' }, 'update').missingIdentifier).toBe(true);
    expect(taxonomyMappingGaps({ 0: 'nebrax_id' }, 'update').missingIdentifier).toBe(false);
    expect(taxonomyMappingGaps({ 0: 'name' }, 'update').missingIdentifier).toBe(false);
    expect(taxonomyMappingGaps({ 0: 'name' }, 'update').missingName).toBe(false);
    expect(taxonomyMappingGaps({ 0: 'name', 1: 'name' }, 'create').duplicate).toBe(true);
  });

  it('sends the kind and policies, the parent policy for categories only, and an explicit "ignore" for unmatched columns', () => {
    const form = taxonomyImportFormData(new File(['x'], 'c.csv'), { ...category, mode: 'upsert', blankPolicy: 'clear', parentPolicy: 'create_missing', mapping: { 0: 'name', 1: null } });
    expect([form.get('kind'), form.get('mode'), form.get('blank_policy'), form.get('parent_policy'), form.get('mapping[0]'), form.get('mapping[1]')])
      .toEqual(['category', 'upsert', 'clear', 'create_missing', 'name', 'ignore']);

    const brand = taxonomyImportFormData(new File(['x'], 'b.csv'), { ...category, kind: 'brand', parentPolicy: 'create_missing' });
    expect(brand.get('kind')).toBe('brand');
    expect(brand.has('parent_policy')).toBe(false);
  });

  it('builds job options identical to the preview ones', () => {
    expect(taxonomyJobOptions(category)).toEqual({ kind: 'category', mode: 'create', blank_policy: 'ignore', parent_policy: 'error' });
    expect(taxonomyJobOptions({ ...category, kind: 'brand', mapping: { 0: 'name' } })).toEqual({ kind: 'brand', mode: 'create', blank_policy: 'ignore', mapping: { 0: 'name' } });
  });

  it('adopts the server suggestion and neutralises spreadsheet formulas', () => {
    expect(suggestedTaxonomyMapping([{ index: 0, header: 'h', samples: [], suggested_field: 'name' }, { index: 1, header: 'x', samples: [], suggested_field: null }])).toEqual({ 0: 'name', 1: null });
    expect(spreadsheetSafe('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(spreadsheetSafe('عادي')).toBe('عادي');
  });
});
