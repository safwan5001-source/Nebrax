const REVISION_PATH_LABEL_KEYS: Record<string, string> = {
  document_types: 'revision_path_document_types',
  'definition.template_id': 'revision_path_template_id',
  'definition.theme_id': 'revision_path_theme_id',
  'definition.show_logo': 'revision_path_show_logo',
  'definition.footer_text': 'revision_path_footer_text',
  'definition.terms_text': 'revision_path_terms_text',
  'definition.bank_text': 'revision_path_bank_text',
  'definition.logo_height': 'revision_path_logo_height',
  'definition.stamp': 'revision_path_stamp',
  'definition.signature': 'revision_path_signature',
  'definition.layout': 'revision_path_layout',
};

/** يعيد مفتاح تسمية أعمال مترجمة لمسار فرق محفوظ، من دون تغيير المسار أو قيمته. */
export function getRevisionPathLabelKey(path: string): string {
  return REVISION_PATH_LABEL_KEYS[path] ?? 'revision_path_unknown';
}
