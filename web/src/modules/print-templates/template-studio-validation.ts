import type { DocSectionKey } from '@/modules/documents/types';

export type TemplateStudioWorkspace = 'structure' | 'properties' | 'preview' | 'governance';

export type TemplateStudioValidationKind = 'required' | 'property' | 'layout';

export interface TemplateStudioValidationIssue {
  code: string;
  kind: TemplateStudioValidationKind;
  target: Extract<TemplateStudioWorkspace, 'structure' | 'properties'>;
  section: DocSectionKey | null;
}

const PROPERTY_ERROR_PREFIXES = [
  'invalid_block_alignment:',
  'invalid_block_font_size:',
  'invalid_block_image_opacity:',
  'invalid_block_image_size:',
  'invalid_static_content:',
  'unsupported_block_property:',
] as const;

/** يحول رموز عقد التخطيط إلى وجهة إصلاح واجهية من دون تغيير مصدر الحقيقة الخادمي. */
export function templateStudioValidationIssues(errors: readonly string[]): TemplateStudioValidationIssue[] {
  return errors.map((code) => {
    const [, key = ''] = code.split(':');
    const section = (key || null) as DocSectionKey | null;
    if (code.startsWith('required_block_hidden:')) {
      return { code, kind: 'required', target: 'structure', section };
    }
    if (PROPERTY_ERROR_PREFIXES.some((prefix) => code.startsWith(prefix))) {
      return { code, kind: 'property', target: 'properties', section };
    }
    return { code, kind: 'layout', target: 'structure', section };
  });
}
