import { describe, expect, it } from 'vitest';
import { templateStudioValidationIssues } from './template-studio-validation';

describe('template studio validation issues', () => {
  it('routes missing required blocks to the structure surface', () => {
    expect(templateStudioValidationIssues(['required_block_hidden:items'])).toEqual([
      { code: 'required_block_hidden:items', kind: 'required', target: 'structure', section: 'items' },
    ]);
  });

  it('routes block property errors to the properties surface', () => {
    expect(templateStudioValidationIssues([
      'invalid_block_alignment:footer',
      'unsupported_block_property:stamp:image_opacity',
    ])).toEqual([
      { code: 'invalid_block_alignment:footer', kind: 'property', target: 'properties', section: 'footer' },
      { code: 'unsupported_block_property:stamp:image_opacity', kind: 'property', target: 'properties', section: 'stamp' },
    ]);
  });

  it('keeps unsupported and duplicate blocks in the structure surface', () => {
    expect(templateStudioValidationIssues([
      'duplicate_block:items',
      'unsupported_block:signature',
    ])).toEqual([
      { code: 'duplicate_block:items', kind: 'layout', target: 'structure', section: 'items' },
      { code: 'unsupported_block:signature', kind: 'layout', target: 'structure', section: 'signature' },
    ]);
  });
});
