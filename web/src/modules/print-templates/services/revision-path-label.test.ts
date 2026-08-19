import { describe, expect, it } from 'vitest';
import { getRevisionPathLabelKey } from './revision-path-label';

describe('تسميات فروقات مراجعات القالب', () => {
  it('يحوّل المسارات المدعومة إلى مفاتيح أعمال مترجمة', () => {
    expect(getRevisionPathLabelKey('definition.theme_id')).toBe('revision_path_theme_id');
    expect(getRevisionPathLabelKey('definition.layout')).toBe('revision_path_layout');
    expect(getRevisionPathLabelKey('document_types')).toBe('revision_path_document_types');
  });

  it('يحفظ المسارات المستقبلية في مفتاح احتياطي قابل للتدقيق', () => {
    expect(getRevisionPathLabelKey('definition.future_property')).toBe('revision_path_unknown');
  });
});
