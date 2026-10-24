import { describe, expect, it } from 'vitest';
import {
  spreadsheetSafe,
  suggestedUnitTemplateMapping,
  unitTemplateImportFormData,
  unitTemplateJobOptions,
  unitTemplateMappingGaps,
} from './contract';

describe('unit template import contract (IMP-H4-S6c)', () => {
  it('requires the template name and base unit', () => {
    expect(unitTemplateMappingGaps({ 0: 'template_name', 1: 'base_unit' })).toEqual({ missingName: false, missingBaseUnit: false, unpairedUnitFactor: false, duplicate: false });
    expect(unitTemplateMappingGaps({ 0: 'base_unit' }).missingName).toBe(true);
    expect(unitTemplateMappingGaps({ 0: 'template_name' }).missingBaseUnit).toBe(true);
  });

  it('requires the alternate unit and the factor together or not at all', () => {
    const base = { 0: 'template_name', 1: 'base_unit' };
    expect(unitTemplateMappingGaps({ ...base, 2: 'unit_name', 3: 'factor' }).unpairedUnitFactor).toBe(false);
    expect(unitTemplateMappingGaps({ ...base, 2: 'unit_name' }).unpairedUnitFactor).toBe(true);
    expect(unitTemplateMappingGaps({ ...base, 2: 'factor' }).unpairedUnitFactor).toBe(true);
    expect(unitTemplateMappingGaps({ ...base, 2: 'unit_name', 3: 'factor', 4: 'is_active' }).unpairedUnitFactor).toBe(false);
  });

  it('flags a field mapped to more than one column', () => {
    expect(unitTemplateMappingGaps({ 0: 'template_name', 1: 'template_name', 2: 'base_unit' }).duplicate).toBe(true);
  });

  it('sends the same options to the preview and to the frozen job so their fingerprints match', () => {
    const options = { existingPolicy: 'skip' as const, mapping: { 0: 'template_name', 1: null, 2: 'base_unit' } };
    const form = unitTemplateImportFormData(new File(['x'], 'u.csv'), options);

    expect([form.get('existing_policy'), form.get('mapping[0]'), form.get('mapping[1]'), form.get('mapping[2]')]).toEqual(['skip', 'template_name', 'ignore', 'base_unit']);
    expect(unitTemplateJobOptions(options)).toEqual({ existing_policy: 'skip', mapping: { 0: 'template_name', 1: null, 2: 'base_unit' } });
  });

  it('omits the mapping when none was inspected and takes suggestions from the server', () => {
    expect(unitTemplateJobOptions({ existingPolicy: 'error' })).toEqual({ existing_policy: 'error' });
    expect(suggestedUnitTemplateMapping([{ index: 0, header: 'a', samples: [], suggested_field: 'base_unit' }, { index: 1, header: 'b', samples: [], suggested_field: null }])).toEqual({ 0: 'base_unit', 1: null });
  });

  it('neutralises spreadsheet formulas in the error report', () => {
    expect(spreadsheetSafe('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(spreadsheetSafe('كرتون')).toBe('كرتون');
  });
});
