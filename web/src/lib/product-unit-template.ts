export interface ProductUnitTemplate {
  id: string;
  name: string;
  base_unit: string;
  /** الوحدات البديلة بمعاملاتها كما يعيدها `UnitTemplateResource`. */
  units?: Array<{ id?: string; name: string; factor: number }>;
  is_active?: boolean;
}

/**
 * يُبقي وحدة المنتج متسقة مع وحدة الأساس للقالب المختار.
 * عند إزالة القالب تبقى الوحدة الحالية، لتصبح قابلة للتحرير اليدوي.
 */
export function productUnitForTemplate(
  templateId: string,
  templates: ProductUnitTemplate[],
  currentUnit: string,
): string {
  return templates.find((template) => template.id === templateId)?.base_unit ?? currentUnit;
}
