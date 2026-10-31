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
  schema?: AppSchema;
  published_by: string | null;
  published_by_name: string | null;
  published_at: string | null;
}

/** MOBILE-PREVIEW-6 — تطابق `PreviewSessionResource`. لا يحمل هذا النوع التوكن الخام أبداً. */
export interface PreviewSession {
  id: string;
  builder_app_id: string;
  source: 'draft' | 'published' | 'default';
  channel: 'browser' | 'device';
  device_label: string | null;
  draft_revision: number | null;
  created_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export function appDisplayName(app: Pick<BuilderApp, 'name' | 'name_en'>, locale: string): string {
  return locale.toLowerCase().startsWith('en') && app.name_en ? app.name_en : app.name;
}

/**
 * APP-BUILDER-21 — يختار تسمية بشرية من `RegistryLabel` حسب اللغة الحالية،
 * مطابقاً لنمط `appDisplayName` تماماً. لا يُستهلَك لتغيير أي معرّف داخلي —
 * عرضي بحت في Inspector/Layers/Canvas.
 */
export function registryLabel(label: RegistryLabel, locale: string): string {
  return locale.toLowerCase().startsWith('en') ? label.en : label.ar;
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

// ── Binding + Visibility (APP-BUILDER-14/16, edited by APP-BUILDER-15's Inspector) ──
// شكلا `binding`/`visibility` هنا يطابقان حرفياً ما يتحقّقه `AppSchemaParser`
// بنيوياً (لا محرّك تعابير — قيَم سكالر/قوائم فقط). صحّة هوية المورد/الإشارة/
// المُشغّل وتوافق النوع تُتحقَّق خادمياً وقت النشر (`CompatibilityResolver`)،
// لا هنا — هذه الأنواع تصف الشكل المسموح تركيبياً فقط.

export interface AppSchemaBinding {
  resource: string;
  query?: Record<string, unknown>;
  itemProps?: Record<string, string>;
  /**
   * LIVE-PREVIEW-2 — closes a structural gap this type left open since
   * `APP-BUILDER-17` slice 3 added `SchemaBinding.collect`
   * (`mobile/lib/schema/app_schema.dart`): a dotted field path to a
   * `LIST`-typed field on the resolved resource whose entries the node's
   * single declared child (its item template) repeats once per, exactly
   * like `itemProps`'s own field-path convention. `undefined` means "no
   * repetition" — same meaning as the Dart side's `null`. Additive only;
   * does not change how any existing field is read or validated.
   */
  collect?: string;
}

export type VisibilityScalar = string | number | boolean | null;

export interface VisibilityLeaf {
  signal: string;
  operator: string;
  value?: VisibilityScalar | VisibilityScalar[];
}

export interface VisibilityAll {
  all: VisibilityNode[];
}

export interface VisibilityAny {
  any: VisibilityNode[];
}

export type VisibilityNode = VisibilityAll | VisibilityAny | VisibilityLeaf;

export function isVisibilityLeaf(node: VisibilityNode): node is VisibilityLeaf {
  return 'signal' in node;
}

export interface AppSchemaComponent {
  type: string;
  id: string;
  optional?: boolean;
  props?: Record<string, unknown>;
  children?: AppSchemaComponent[];
  action?: AppSchemaActionRef;
  binding?: AppSchemaBinding;
  visibility?: VisibilityNode;
}

export interface AppSchema {
  schemaVersion: string;
  minRuntimeVersion: string;
  requiredCapabilities?: Record<string, number>;
  theme?: { tokens?: Record<string, string> };
  navigation: { initialPageId: string };
  pages: Record<string, AppSchemaComponent>;
}

/** AD-05 (S20a): بيانات المحرر المستقلة عن المخطط — `contracts/app-builder/editor-meta.v1.json`. لا تغادر المسودة. */
export interface EditorMetaNode { name?: string; hidden?: true; preset?: string }
export interface EditorMeta {
  v: 1;
  /** مقيَّدة بالصفحة: `nodes[pageId][nodeId]` (فرادة معرّف المكوّن داخل الصفحة وحدها). */
  nodes: Record<string, Record<string, EditorMetaNode>>;
  pages: Record<string, { title?: string }>;
}

export interface BuilderDraftExperience {
  id: string;
  builder_app_id: string;
  schema: AppSchema;
  /** null = لا بيانات (كل المسودات القديمة). */
  editor_meta?: EditorMeta | null;
  revision: number;
  updated_at: string | null;
}

/** DRF-03 / CMP-10 (S03b): تقرير توافق استشاري لكل جيل Runtime معروف — ما سيُحذف (اختيارياً) يظهر بمعرّفه لا صامتاً. */
export interface CompatDropped { component_id: string; component_type: string }
export interface CompatGeneration { runtime: string; compatible: boolean; reason: string | null; dropped: CompatDropped[] }
export interface CompatReport {
  generations: CompatGeneration[];
  /** أقدم جيل يعرض التجربة (قد تُحذف منها اختيارية). */
  min_runtime: string | null;
  /** أقدم جيل يعرضها كاملةً بلا حذف. */
  full_runtime: string | null;
  has_drops: boolean;
}

export const EMPTY_EDITOR_META: EditorMeta = { v: 1, nodes: {}, pages: {} };

/** يُسقط العقد المخفية وأبناءها من جذر صفحة — مرآة `EditorMeta::project` في الخادم (ما يراه المتجر والمعاينة). لا يحوّر المدخل. */
export function projectPageRoot(root: AppSchemaComponent, meta: EditorMeta | null | undefined, pageId: string): AppSchemaComponent {
  const hidden = new Set(Object.entries(meta?.nodes[pageId] ?? {}).filter(([, n]) => n.hidden === true).map(([id]) => id));
  if (hidden.size === 0) return root;
  const prune = (node: AppSchemaComponent): AppSchemaComponent => {
    if (!node.children) return node;
    return { ...node, children: node.children.filter((child) => !hidden.has(child.id)).map(prune) };
  };
  return prune(root);
}

/** إدخالات عقد صفحة واحدة (فارغة إن لم يوجد). */
const NO_NODES: Record<string, EditorMetaNode> = {};
export function pageNodeMeta(meta: EditorMeta | null | undefined, pageId: string | null): Record<string, EditorMetaNode> {
  return (pageId && meta?.nodes[pageId]) || NO_NODES;
}

/** تحديث غير مغيِّر لإدخال عقدة؛ إدخال فارغ يُحذف، وبيانات فارغة تعود `null`. */
export function updateEditorMetaNode(meta: EditorMeta | null | undefined, pageId: string, nodeId: string, patch: Partial<Omit<EditorMetaNode, 'hidden'>> & { hidden?: boolean }): EditorMeta | null {
  const base = meta ?? EMPTY_EDITOR_META;
  const next: EditorMetaNode = { ...(base.nodes[pageId]?.[nodeId] ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'hidden') {
      if (value === true) next.hidden = true; else delete next.hidden;
    } else if (typeof value === 'string' && value.trim() !== '') {
      (next as Record<string, unknown>)[key] = value.trim();
    } else {
      delete (next as Record<string, unknown>)[key];
    }
  }
  const pageNodes = { ...(base.nodes[pageId] ?? {}) };
  if (Object.keys(next).length === 0) delete pageNodes[nodeId]; else pageNodes[nodeId] = next;
  const nodes = { ...base.nodes };
  if (Object.keys(pageNodes).length === 0) delete nodes[pageId]; else nodes[pageId] = pageNodes;
  return compactEditorMeta({ ...base, nodes });
}

export function updateEditorMetaPageTitle(meta: EditorMeta | null | undefined, pageId: string, title: string): EditorMeta | null {
  const base = meta ?? EMPTY_EDITOR_META;
  const pages = { ...base.pages };
  if (title.trim() === '') delete pages[pageId]; else pages[pageId] = { title: title.trim() };
  return compactEditorMeta({ ...base, pages });
}

function compactEditorMeta(meta: EditorMeta): EditorMeta | null {
  return Object.keys(meta.nodes).length === 0 && Object.keys(meta.pages).length === 0 ? null : meta;
}

// ── Component/Action registries (APP-BUILDER-3, serialized by AppBuilderRegistryController) ──

/**
 * APP-BUILDER-21 — تسمية بشرية ثنائية اللغة لمعرّف مخطط داخلي. لا تُستهلَك
 * كبديل عن المعرّف الداخلي (`type`/`key`) في أي مكان يُرسَل فيه المخطط —
 * عرضية بحتة في Inspector/Layers/Canvas فقط.
 */
export interface RegistryLabel {
  ar: string;
  en: string;
}

export interface RegistryPropDefinition {
  key: string;
  type: string;
  required: boolean;
  label: RegistryLabel;
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
  label: RegistryLabel;
  props: RegistryPropDefinition[];
  children_rule: RegistryChildrenRule;
  actionable: boolean;
  injected_runtime_action_params: string[];
  notes: string;
  bindable_resources: string[];
  /** AD-12: قواعد التضمين من الخادم (غائبة عن خادم أقدم ⇒ يسقط الويب على `children_rule`). */
  allowed_children?: string[];
  allowed_parents?: string[];
}

/** AD-12 (S02): مشكلة عقد من الخادم. `blocks_publish` ⇒ تمنع النشر؛ لا تمنع الحفظ أبداً. */
export interface ContractIssue {
  code: string;
  severity: 'error' | 'warning';
  page_id: string;
  node_id: string | null;
  field: string | null;
  message: string;
  blocks_publish: boolean;
}

export interface RegistryActionParamDefinition {
  key: string;
  type: string;
  required: boolean;
  label: RegistryLabel;
  nullable: boolean;
  default: unknown;
  min_value: number | null;
}

export interface RegistryActionDefinition {
  type: string;
  version: number;
  risk_class: string;
  label: RegistryLabel;
  params: RegistryActionParamDefinition[];
  dispatch_status: string;
  notes: string;
}

export interface RegistryResourceField {
  key: string;
  type: string;
  localized: boolean;
}

export interface RegistryResourceQueryParam {
  key: string;
  kind: 'filter' | 'sort';
}

export interface RegistryResourceDefinition {
  id: string;
  version: number;
  shape: 'list' | 'single';
  paginated: boolean;
  fields: RegistryResourceField[];
  query_params: RegistryResourceQueryParam[];
}

export interface RegistryVisibilityOperator {
  type: string;
  value_arity: 'none' | 'single' | 'list';
}

export interface AppBuilderRegistries {
  components: Record<string, RegistryComponentDefinition>;
  actions: Record<string, RegistryActionDefinition>;
  resources: Record<string, RegistryResourceDefinition>;
  visibility_signals: string[];
  visibility_operators: RegistryVisibilityOperator[];
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

/** يُدرج عقدة بعد أخٍ محدد داخل `parentId` (أو في النهاية إن لم يوجد/كان `afterId` null) — AD-12: المعرّفات تبقى فريدة بتوليد جديد من المستدعي. */
export function insertChildAfter(
  root: AppSchemaComponent,
  parentId: string,
  afterId: string | null,
  newNode: AppSchemaComponent
): AppSchemaComponent {
  return updateComponentById(root, parentId, (node) => {
    const children = node.children ?? [];
    const index = afterId ? children.findIndex((child) => child.id === afterId) : -1;
    const next = [...children];
    next.splice(index < 0 ? next.length : index + 1, 0, newNode);
    return { ...node, children: next };
  });
}

/** نسخة عميقة من شجرة عقدة بمعرّفات جديدة لكل عقدة (التكرار لا يُنتج معرّفاً مكرراً أبداً — AD-12/CMP-14). */
export function cloneWithFreshIds(node: AppSchemaComponent): AppSchemaComponent {
  const copy = JSON.parse(JSON.stringify(node)) as AppSchemaComponent;
  const reId = (n: AppSchemaComponent): AppSchemaComponent => ({
    ...n,
    id: generateComponentId(n.type),
    ...(n.children ? { children: n.children.map(reId) } : {}),
  });
  return reId(copy);
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

// ── عقد رموز الثيم القانوني (AD-03 / S04b) ───────────────────────────────────
// `colorPrimary` هو الاسم القانوني؛ `primaryColor` (الويب القديم) مرادف **مقروء فقط** — مرآة `seedColorFromTokens` في Flutter.
// الكتابة تُطبِّع (تعيد التسمية وتُسقط متغيرات العرض المشتقّة)؛ القراءة وحدها لا تمسّ شيئاً (لا إعادة كتابة جماعية).
export const PRIMARY_COLOR_TOKEN = 'colorPrimary';
export const LEGACY_PRIMARY_COLOR_TOKEN = 'primaryColor';
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** أول لون `#RRGGBB` صالح بترتيب (قانوني، مرادف)، أو `null`. يُقصّ الفراغ المحيط كما يفعل Flutter. */
export function readPrimaryColor(tokens: Record<string, string> | null | undefined): string | null {
  for (const key of [PRIMARY_COLOR_TOKEN, LEGACY_PRIMARY_COLOR_TOKEN]) {
    const raw = tokens?.[key]?.trim();
    if (raw && HEX6.test(raw)) return raw;
  }
  return null;
}

/**
 * الشكل القانوني لرموز الثيم عند الكتابة: `colorPrimary` بدل المرادف القديم (القانوني الصالح يتقدّم، والمرادف غير الصالح يُسقَط ولا يُرقّى)،
 * ويُسقَط ما يبدأ بـ`--` (متغيرات CSS مشتقّة كانت اللوحة القديمة تحفظها — العرض يشتقّها ولا تُخزَّن). لا يحوّر المدخل.
 */
export function canonicalizeThemeTokens(tokens: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (key.startsWith('--') || key === LEGACY_PRIMARY_COLOR_TOKEN || key === PRIMARY_COLOR_TOKEN) continue;
    out[key] = value;
  }
  const primary = readPrimaryColor(tokens);
  return primary ? { [PRIMARY_COLOR_TOKEN]: primary, ...out } : out;
}

/** يدمج رموزاً جديدة/محدَّثة في `theme.tokens` ويُطبِّعها (القانوني) — لا يحذف مفاتيح غائبة عن `patch` غير ما تُسقطه التسوية. */
export function mergeThemeTokens(schema: AppSchema, patch: Record<string, string>): AppSchema {
  return { ...schema, theme: { ...schema.theme, tokens: canonicalizeThemeTokens({ ...themeTokens(schema), ...patch }) } };
}

// ── Page-map edit helpers (APP-BUILDER-9) ────────────────────────────────────
// `schema.pages`/`navigation.initialPageId` حقلان حقيقيان بالفعل — لا مفهوم
// جديد. الضمانات هنا تعكس فقط ما يتحقّقه `AppSchemaParser::validate()` خادمياً
// أصلاً (pages غير فارغة، initialPageId يشير لصفحة معرَّفة): كلا الدالتين
// المؤثّرتين تصمتان (لا تغيير) إن كانت النتيجة ستنتج حالة يرفضها الخادم، لا
// تخمين إعادة إسناد.

/** معرّف صفحة جديد فريد بما يكفي لمخطط تحرير واحد — لا يفترض تفرداً عالمياً. */
export function generatePageId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `page-${random}`;
}

/** يضيف صفحة فارغة جديدة بمعرّف `pageId` المعطى (استدعِ `generatePageId` أولاً). */
export function addPage(schema: AppSchema, pageId: string): AppSchema {
  return { ...schema, pages: { ...schema.pages, [pageId]: { type: 'Page', id: `${pageId}-root`, children: [] } } };
}

/** يحذف صفحة بمعرّفها — صامتة (بلا تغيير) إن كانت الصفحة الأخيرة أو الصفحة الرئيسية الحالية. */
export function removePage(schema: AppSchema, pageId: string): AppSchema {
  if (Object.keys(schema.pages).length <= 1) return schema;
  if (schema.navigation.initialPageId === pageId) return schema;
  const nextPages = { ...schema.pages };
  delete nextPages[pageId];
  return { ...schema, pages: nextPages };
}

/** يجعل صفحة بمعرّفها هي الصفحة الرئيسية — صامتة إن لم تكن الصفحة معرَّفة أصلاً. */
export function setInitialPage(schema: AppSchema, pageId: string): AppSchema {
  if (!(pageId in schema.pages)) return schema;
  return { ...schema, navigation: { ...schema.navigation, initialPageId: pageId } };
}
