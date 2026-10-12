/**
 * The version a theme is previewed over: what the shopper sees today (the Published Version), else the most recently touched
 * Version. The theme is applied to a COPY of that document, so the choice never changes any Version.
 */
export function previewBaseVersion<V extends { id: string; state: string; updatedAt: string | null }>(versions: readonly V[]): V | null {
  const published = versions.find((version) => version.state === 'published');
  if (published) return published;
  return (
    [...versions].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null
  );
}

export function themePreviewHref(themeId: string, baseVersionId: string | null): string {
  const params = new URLSearchParams();
  if (baseVersionId) params.set('version', baseVersionId);
  params.set('previewTheme', themeId);
  return `/commerce/appearance?${params.toString()}`;
}
