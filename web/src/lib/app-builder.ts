/** APP-BUILDER-4 — أنواع مشتركة لواجهة AWJ App Builder، تطابق `BuilderAppResource`/`BuilderPublishedExperienceVersionResource`. */

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
