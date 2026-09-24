/**
 * أنواع مشتركة لواجهة AWJ App Builder.
 * APP-BUILDER-4: تطابق `BuilderAppResource`/`BuilderPublishedExperienceVersionResource`.
 * APP-BUILDER-5: تطابق `BuilderDraftExperienceResource` (شكل `schema` الحقيقي —
 * `mobile/lib/schema/app_schema.dart`، لا الشكل التوضيحي) و`AppBuilderRegistryController`.
 */

export type CreationSource = 'store_design' | 'template' | 'scratch';

export const CREATION_SOURCES: CreationSource[] = ['store_design', 'template', 'scratch'];

export interface BuilderApp {
  id: string;
  name: string;
  name_en: string | null;
  creation_source: CreationSource;
  latest_published_version?: number | null;
  created_at: string;
  updated_at: string;
}

export interface BuilderPublishedVersion {
  id: string;
  builder_app_id: string;
  version: number;
  schema_version: string;
  note: string | null;
  published_at: string | null;
}

export function appDisplayName(app: Pick<BuilderApp, 'name' | 'name_en'>, locale: string): string {
  return locale.toLowerCase().startsWith('en') && app.name_en ? app.name_en : app.name;
}

export function hasAppBuilderPermission(
  user: { role: string; permissions?: string[] } | null,
  permission: string
): boolean {
  if (!user) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.permissions?.includes('*') || user.permissions?.includes(permission) || false;
}

// ── App Schema (mobile/lib/schema/app_schema.dart) ──────────────────────────

export interface AppSchemaActionRef {
  type: string;
  params?: Record<string, unknown>;
}

export interface AppSchemaComponent {
  type: string;
  id: string;
  optional?: boolean;
  props?: Record<string, unknown>;
  children?: AppSchemaComponent[];
  action?: AppSchemaActionRef;
}

export interface AppSchema {
  schemaVersion: string;
  minRuntimeVersion: string;
  requiredCapabilities?: Record<string, number>;
  theme?: { tokens?: Record<string, string> };
  navigation: { initialPageId: string };
  pages: Record<string, AppSchemaComponent>;
}

export interface BuilderDraftExperience {
  id: string;
  builder_app_id: string;
  schema: AppSchema;
  revision: number;
  updated_at: string | null;
}

// ── Component/Action registries (APP-BUILDER-3, serialized by AppBuilderRegistryController) ──

export interface RegistryPropDefinition {
  key: string;
  type: string;
  required: boolean;
  default: unknown;
  enum_values: string[] | null;
}

export interface RegistryChildrenRule {
  kind: 'none' | 'unboundedAny';
  suggested_child_type: string | null;
}

export interface RegistryComponentDefinition {
  type: string;
  version: number;
  category: string;
  props: RegistryPropDefinition[];
  children_rule: RegistryChildrenRule;
  actionable: boolean;
  injected_runtime_action_params: string[];
  notes: string;
}

export interface RegistryActionParamDefinition {
  key: string;
  type: string;
  required: boolean;
  nullable: boolean;
  default: unknown;
  min_value: number | null;
}

export interface RegistryActionDefinition {
  type: string;
  version: number;
  risk_class: string;
  params: RegistryActionParamDefinition[];
  dispatch_status: string;
  notes: string;
}

export interface AppBuilderRegistries {
  components: Record<string, RegistryComponentDefinition>;
  actions: Record<string, RegistryActionDefinition>;
}

/** يبحث عن عقدة بمعرّفها ضمن شجرة صفحة — أول تطابق بعمقٍ أول. */
export function findComponentById(root: AppSchemaComponent, id: string): AppSchemaComponent | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findComponentById(child, id);
    if (found) return found;
  }
  return null;
}

// ── Tree edit helpers (APP-BUILDER-6) ────────────────────────────────────────
// كلها نقية/غير قابلة للتحوّر: تُعيد جذراً جديداً بدل تعديل الجذر المُعطى في
// مكانه، فيبقى مصدر تاريخ التراجع/الإعادة في الصفحة مجرد مصفوفة من المراجع
// القديمة دون نسخ عميق يدوي في كل خطوة.

/** يبحث عن معرّف الأب المباشر لعقدة — `null` إن كانت هي الجذر أو غير موجودة. */
export function findParentId(root: AppSchemaComponent, childId: string): string | null {
  for (const child of root.children ?? []) {
    if (child.id === childId) return root.id;
    const found = findParentId(child, childId);
    if (found) return found;
  }
  return null;
}

/** يستبدل عقدة بمعرّفها بنتيجة `updater` — لا تأثير إن لم يُعثر عليها. */
export function updateComponentById(
  root: AppSchemaComponent,
  id: string,
  updater: (node: AppSchemaComponent) => AppSchemaComponent
): AppSchemaComponent {
  if (root.id === id) return updater(root);
  const children = root.children;
  if (!children || children.length === 0) return root;
  return { ...root, children: children.map((child) => updateComponentById(child, id, updater)) };
}

/** يُلحِق عقدة جديدة بنهاية أبناء عقدة الحاوية `parentId`. */
export function addChildComponent(
  root: AppSchemaComponent,
  parentId: string,
  newNode: AppSchemaComponent
): AppSchemaComponent {
  return updateComponentById(root, parentId, (node) => ({ ...node, children: [...(node.children ?? []), newNode] }));
}

/** يحذف عقدة بمعرّفها من أبناء أبيها — لا تأثير على الجذر نفسه. */
export function removeComponentById(root: AppSchemaComponent, id: string): AppSchemaComponent {
  if (!root.children || root.children.length === 0) return root;
  return {
    ...root,
    children: root.children.filter((child) => child.id !== id).map((child) => removeComponentById(child, id)),
  };
}

/** يُعيد ترتيب أبناء عقدة أبٍ واحدة بمصفوفة مُرتّبة جديدة من نفس المعرّفات — لا نقل بين آباء مختلفين. */
export function reorderChildren(root: AppSchemaComponent, parentId: string, orderedChildIds: string[]): AppSchemaComponent {
  return updateComponentById(root, parentId, (node) => {
    const byId = new Map((node.children ?? []).map((child) => [child.id, child]));
    const reordered = orderedChildIds.map((id) => byId.get(id)).filter((child): child is AppSchemaComponent => Boolean(child));
    return { ...node, children: reordered };
  });
}

/** يبدّل عقدة بجارتها المباشرة (سابقة/تالية) ضمن قائمة إخوتها. */
export function moveSibling(root: AppSchemaComponent, id: string, direction: 'up' | 'down'): AppSchemaComponent {
  const parentId = findParentId(root, id);
  if (!parentId) return root;
  return updateComponentById(root, parentId, (node) => {
    const children = node.children ?? [];
    const index = children.findIndex((child) => child.id === id);
    const targetIndex = index + (direction === 'up' ? -1 : 1);
    if (index < 0 || targetIndex < 0 || targetIndex >= children.length) return node;
    const next = [...children];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return { ...node, children: next };
  });
}

/** معرّف عقدة جديد فريد بما يكفي لمخطط تحرير واحد — لا يفترض تفرداً عالمياً. */
export function generateComponentId(type: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${type.toLowerCase()}-${random}`;
}

/** ينشئ عقدة جديدة بقيَم `props` الافتراضية من تعريف السجلّ (يترك ما لا افتراضي له لعرض المكوّن الدفاعي). */
export function createComponentFromDefinition(type: string, definition: RegistryComponentDefinition): AppSchemaComponent {
  const props: Record<string, unknown> = {};
  for (const prop of definition.props) {
    if (prop.default !== null && prop.default !== undefined) props[prop.key] = prop.default;
  }
  return {
    type,
    id: generateComponentId(type),
    ...(Object.keys(props).length > 0 ? { props } : {}),
  };
}

// ── Theme edit helpers (APP-BUILDER-8) ───────────────────────────────────────
// `schema.theme.tokens` وحده الحقل الحقيقي — خريطة سلاسل حرّة يتحقّقها الخادم
// بنيوياً فقط (`AppSchemaParser::validateTheme`)، بلا قائمة مفاتيح مغلقة، بلا
// بوابة قدرة/توافق (`CompatibilityResolver`/`CapabilityManifest` لا يذكرانها).

/** رموز المظهر الحالية — كائن فارغ إن لم توجد بعد. */
export function themeTokens(schema: AppSchema): Record<string, string> {
  return schema.theme?.tokens ?? {};
}

/** يدمج رموزاً جديدة/محدَّثة في `theme.tokens` — لا يحذف مفاتيح غائبة عن `patch`. */
export function mergeThemeTokens(schema: AppSchema, patch: Record<string, string>): AppSchema {
  return { ...schema, theme: { ...schema.theme, tokens: { ...themeTokens(schema), ...patch } } };
}
