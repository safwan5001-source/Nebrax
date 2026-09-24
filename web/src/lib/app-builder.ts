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
  theme?: { tokens?: Record<string, unknown> };
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
