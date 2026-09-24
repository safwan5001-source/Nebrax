# APP-BUILDER-10 — UI/UX Evidence Pass

Written before implementation, per the horizon bootstrap's mandatory workflow. This is the
workspace's first publish-surface UI — a "major user-facing Builder slice" by the bootstrap's own
test, and the first task in this horizon that touches backend files since `APP-BUILDER-2`.

## Scope, fixed by evidence before design

A dedicated research pass (direct reading of `BuilderPublishedExperienceVersion`/
`BuilderDraftExperience` models, `BuilderPublishedExperienceVersionService`, `routes/api.php`,
`Rbac.php`, `APP-BUILDER-1`/`APP-BUILDER-2`'s own implementation reports, and the architecture
doc's §9/"Validation UX"/"Publish flow"/"Version comparison" sections) fixed what this task can
honestly build, and — as important — what would repeat `APP-BUILDER-7`'s mistake of inventing a
contract the architecture doc itself says is undecided:

- **Already real and built (`APP-BUILDER-1`/`2`):** `BuilderPublishedExperienceVersion` rows are
  fully immutable (a model-level `booted()` guard rejects any `update`/`delete` outright, no
  escape hatch), version numbers are race-safe and sequential per app, each row snapshots the full
  schema independently of later draft edits. `BuilderPublishedExperienceVersionService::publish()`
  already runs the exact two checks this task's own outcome line asks for —
  `AppSchemaParser::validate()` then `CompatibilityResolver::resolve()` against the live
  `CapabilityManifest`, fail-closed, no partial/staged publish — before creating the version row.
  `apps_builder.publish` is already a distinct, narrower RBAC permission from `.manage`. `GET
  .../versions` and `GET .../versions/{version}` (returning the full historical `schema`) already
  exist and are already called by `/app-builder/[id]`'s read-only version list.
- **Genuinely missing, confirmed by direct grep (zero implementation found anywhere):** a
  standalone validate-only/dry-run endpoint (draft save today only runs structural validation, not
  the compatibility check — a merchant cannot know a draft would fail `CompatibilityResolver`
  without risking a real, RBAC-gated, irreversible-feeling publish attempt); any rollback
  mechanism at all; any Publish/Validate UI anywhere in the frontend.
- **Rollback's real mechanism is not an open design question.** The model's own docblock and
  `RUNTIME_COMPATIBILITY_V1.md` §15 already settle it: "modeled as publishing a new version on top,
  never mutating an old row." Concretely, that means: `GET .../versions/{version}` already returns
  a historical schema in full; restoring it is exactly one `PUT .../draft` call (already accepts
  any structurally-valid schema — no new endpoint) followed by an ordinary publish, which
  automatically re-runs the same compatibility check — "compatibility-safe rollback within
  contract" falls out of the existing pipeline for free, inventing no new validation rule.
- **The architecture doc's richer "Validation UX"/"Publish flow"/"Version comparison" sections
  describe a structured, itemized Blocker/Warning/Info Issues panel, human-readable version diffs,
  and native-build/release impact classification tied to publish.** None of these have any backing
  data model or logic anywhere in the codebase — the same class of "not-yet-decided, described in
  the architecture doc but never locked" gap that made treating `APP-BUILDER-7`'s Data/Conditions/
  Visibility as a hard requirement a Decision Escalation Gate. Task 10's own outcome line ("Draft →
  Validate → Published Experience; immutable versions; compatibility-safe rollback within
  contract") does not require any of them — they are explicitly out of this task's scope, not a
  silently dropped requirement (see Retained/Rejected below).

## External interaction evidence (references only — no visual identity/assets copied)

1. **A confirm-before-irreversible-action dialog, already this codebase's own established
   pattern**, not external: `invoices/[id]/page.tsx`'s "post" confirmation (`Dialog` +
   danger/primary `Button` pair, disabled while the action is in flight) is the closest real
   precedent for "Publish" — publishing an App Builder version is the same shape of action as
   posting an invoice: irreversible, RBAC-gated, needs one clear confirm step, not a wizard.
2. **A version-history list with a restore action per row.** WordPress's revision history and
   Shopify theme "duplicate & publish" flows both show: a flat chronological list, each entry
   showing who/when, and a single explicit action per row rather than a bulk compare/merge UI —
   general evidence for keeping V1's version list "view + one action," not a diff/compare surface
   this task's own scope already excludes.
3. **A visible, blocking validation step before a risky action completes**, not a background
   silent check — common to CI/deploy UIs (a "run checks" step gating a "deploy" button) — general
   evidence for making Validate a distinct, visible step rather than folding it silently into
   Publish with no separate feedback.

## Retained vs. rejected for this task

**Retained:**
- **A "Validate" step, backed by one new thin backend endpoint** — the first backend files this
  horizon touches since `APP-BUILDER-2`. It runs the exact same two validators `publish()` already
  calls (`AppSchemaParser::validate()`, `CompatibilityResolver::resolve()`) against the current
  draft, returning success or the same single clear error message publish would throw — no new
  validation rule invented, no row created, no side effect. Gated by `apps_builder.manage` (part of
  the editing workflow, not merely viewing, and not the narrower `.publish` permission since it
  mutates nothing).
- **A "Publish" confirm dialog** reusing the codebase's own established post-confirmation pattern
  (`Dialog` + note textarea + danger-tone confirm button, disabled while in flight), gated visibly
  by `apps_builder.publish` (hidden/disabled with a clear reason for a `.manage`-only user, never a
  silent failure after they've already filled in a note). Calls Validate first inline; only enables
  the actual confirm once it passes, surfacing the single error message inline if it fails.
- **An expanded Versions view** (`/app-builder/[id]/versions`, since the existing bare list on the
  detail page has no room for a per-row action) — version number, note, published date, **and**
  `published_by` (already stored, not yet exposed in the API resource — a trivial, justified
  Resource addition, not a new concept) — each with one action: "Restore to draft."
- **Rollback = restore + review, never restore + auto-publish.** Clicking "Restore to draft" shows
  a confirm dialog warning it replaces the current draft (an old draft may hold unsaved work), then
  calls the existing `PUT .../draft` with that version's schema and redirects into the Builder
  workspace — the merchant reviews the restored draft exactly like any other edit and must
  explicitly Validate/Publish again through the same flow above. Matches the architecture doc's own
  "Publish is a review flow, not an instant blind button" line by construction, not by a new rule.

**Rejected for this task (explicitly deferred, not silently dropped):**
- **A structured, itemized Blocker/Warning/Info Issues panel.** No backing data model exists;
  building one means `AppSchemaParser`/`CompatibilityResolver` would need to collect every issue
  instead of throwing on the first — a materially larger backend redesign this task's own line does
  not ask for. V1 keeps the single clear error message, the same "fail closed with one message"
  posture `APP-BUILDER-8`'s Store Design sync already established for a comparable failure surface.
- **Human-readable version-to-version diffs.** No diff generation exists anywhere in the backend;
  semantically diffing two schema JSON blobs is a real, separate feature this task's line does not
  require.
- **Native-build/release impact classification tied to publish** (architecture doc's "Update &
  Release Matrix"). No backing model exists at all — mobile app-store submission tracking is a
  wholly separate, unbuilt concern, the same kind of acknowledged-but-out-of-scope gap
  `MOBILE-RUNTIME-7`'s report already recorded for native builds generally.
- **Optimistic-concurrency conflict detection on draft save.** A real gap (`BuilderDraftExperience`
  has a `revision` counter that increments but nothing checks it), already flagged as backlog in
  `APP-BUILDER-1`'s own report — adjacent to, but not stated by, this task's line. Not built here.

## AWJ UX Decision

1. The Builder workspace header (where Save/Undo/Redo already live, `APP-BUILDER-6`) gains a
   "Publish" button beside Save — publishing operates on the same draft the merchant is actively
   editing, so it belongs where editing happens, not only on the separate App Manager detail page.
2. `/app-builder/[id]` (App Manager detail page) keeps its version list but the list itself becomes
   a link to a new `/app-builder/[id]/versions` page for the fuller view + restore action — the
   detail page stays a summary, matching its existing role since `APP-BUILDER-4`.
3. The Publish dialog and the Restore-to-draft confirm dialog both reuse the exact `Dialog` +
   confirm/cancel `Button` pair pattern already shipped in `invoices/[id]/page.tsx`'s "post"
   confirmation — no new dialog shape invented for this task.
4. All new visual language comes from `DESIGN_SYSTEM.md`'s existing tokens/components, per Quality
   Gate D, matching every prior App Builder task's precedent.

## What this pass does not cover

`APP-BUILDER-11`'s integrated vertical proof; the deferred `APP-BUILDER-7` concepts remain entirely
untouched — Validate/Publish/Rollback operate on the whole schema as an opaque, already-validated
document via `AppSchemaParser`/`CompatibilityResolver`, never on `SchemaComponent`-level Actions/
Conditions/Visibility/Data.
