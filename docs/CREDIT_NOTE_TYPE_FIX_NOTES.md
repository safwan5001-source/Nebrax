# Credit-Note Template Design Type Fix

The failing TypeScript diagnostics originated in outdated test fixtures rather than the production mapper. The test was still using removed theme identifiers (`emerald`, `indigo`), the legacy `{ id, enabled }` section-layout shape, and a partial `ResolvedLiveTemplate` object missing `logoHeight`, `stampUrl`, and `signatureUrl`.

The fixtures now use supported `ThemeId` values, the current `{ key, visible }` layout contract, and all required live-template fields. Production code in `credit-note-template-design.ts` remains unchanged.
