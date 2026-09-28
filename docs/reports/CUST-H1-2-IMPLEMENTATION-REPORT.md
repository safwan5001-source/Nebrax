# CUST-H1-2 — Version-aware Customizer UX — Implementation Report

## Status

**READY FOR MERGE — OWNER APPROVAL REQUIRED**

## Repository state

- **Base SHA:** `2e9cdd058a50a2014dc0b4a3c5c0c3302c353616` (`origin/main` at task start — matched the SHA given in the task brief; verified with a fresh `git fetch origin main` before starting).
- **Head SHA:** `3077ecf88c70884c31affb623b445fd3e955f979`
- **Branch:** `claude/cust-h1-2-customizer-ux-23vvun`
- **PR:** [#1085](https://github.com/safwan5001-source/Nebrax/pull/1085)

This Horizon touches `web/` only. No backend/API/migration change — CUST-H1-1's persistence and endpoints (already on `main`) are consumed as-is.

## What changed

### Version selector (toolbar)

`web/src/modules/store-experience-builder/VersionSelector.tsx` — a control in the Customizer header, visually and semantically distinct from any future page selector: icon + truncated version name + derived-state badge (`lg:` and up) + chevron. Desktop/tablet renders it as a popover (via the existing shared `Dropdown` primitive, `mobilePopover` mode so the panel stays viewport-clamped instead of overflowing at 768px); on mobile (`<768px`) the header instead shows a compact truncated-name button (`data-version-selector-mobile`) that opens the Version Manager as a Bottom Sheet — the same `ExperienceBuilder` already uses for its other mobile panels.

### Version Manager

`web/src/modules/store-experience-builder/VersionManagerPanel.tsx` — one presentational component reused verbatim by both the desktop popover and the mobile sheet (no duplicated logic). Per row: name (truncated, `title` on hover), server-derived state (draft/scheduled/published — never a client-invented status), last-modified timestamp, a "currently live"/"currently editing" marker, and scheduled-for timestamp when present. Actions are gated by state exactly per the architecture: Draft → Open/Edit, Rename, Duplicate, Delete (hidden for the row currently open in this editor, as a client-side belt-and-braces on top of the server's own lifecycle checks); Scheduled → Open/Edit, Duplicate (no Delete offered, no reschedule/cancel controls — none exist yet); Published → View, "Create a draft from this version" (Duplicate under the hood), no Delete, no Rename. Empty state offers an inline "create first version" form; loading/error states have explicit retry.

### Create / duplicate / rename / delete

All four route through the existing CUST-H1-1 endpoints (`presentation-versions.ts`, new API client below). Create and duplicate both immediately adopt/open the resulting version (no extra network round-trip — the create/duplicate response already carries the full detail). Rename and delete update the manager's list in place from the authoritative server response; a delete that comes back `409 lifecycle_conflict` (e.g., a row that turned out to be the legacy compatibility version) shows a clear message and refreshes the list rather than trusting stale local state — exactly the case the frontend cannot pre-detect since the API never exposes which version backs the legacy compatibility pointer.

### Exact-version switching, editing, and the stale-callback guard

Selecting a version calls `GET …/versions/{id}` and, only if a monotonically increasing request token still matches when the response arrives, applies it to `draft`/`saved`/`selectedVersion` state. A delayed response from a version the merchant has since switched away from is dropped — proven by a dedicated test that opens Version A, immediately opens Version B, then resolves A's request and asserts B's content and `data-selected-version-id` are unaffected. Saving always targets the exact selected version's id + revision (`PUT …/versions/{id}`), never a legacy/implicit draft. Switching away from a version with unsaved local edits asks for confirmation before discarding them.

### Deterministic default selection (never ambiguous)

On load, the version list is fetched, then:
- exactly one non-published candidate → it is opened automatically;
- zero non-published candidates and exactly one version total → that (published) version is opened, read-only;
- more than one non-published candidate → nothing is auto-selected; the Inspector shows an explicit "choose a version" prompt and the toolbar reads "no version being edited" until the merchant picks one from the manager.

No storefront ever falls back to "guess the current draft" once more than one editable version exists.

### Published read-only

When the selected version's derived state is `published`, the entire Inspector body is replaced by a read-only notice ("this is the live version…") with a single "Create a draft from this version" action; the Save button is disabled with an explanatory `title`; `updateDraft` itself is guarded as defence-in-depth. This is enforced before any edit is attempted, not only via a backend 409.

### No fake Publish (hard scope boundary)

CUST-H1-3 (immediate/exact-version publish) does not exist yet. The Publish button in the toolbar is always rendered but permanently `disabled`, with a `title`/click explanation ("immediate per-version publishing arrives in a later update — use Save to prepare this version now"). The legacy `publishStorefrontPresentation`/`saveStorefrontPresentation`/`loadStorefrontPresentation` calls have been removed from `ExperienceBuilder` entirely — the Customizer now speaks the Version API exclusively once a storefront is selected, per the architecture note that new Customizer UI moves to Version APIs. The legacy endpoints themselves are untouched on the backend and remain reachable by any other client.

### Backward compatibility (no `storefrontId` — local-only editing)

The pre-existing "no storefront selected yet" / standalone `initialConfig`-only mode (used by tests and momentarily during app-shell load) is untouched byte-for-byte: `renderInspectorBody` short-circuits to the plain `ControlPanels` render before any version-related gate when `storefrontId` is absent, exactly as before this Horizon.

### Preview identity

The existing "live preview" strip above the Canvas now also shows the open version's name + derived state, with a non-live warning for Draft/Scheduled and a "currently live" note for Published — satisfying "the merchant must always know which version is being previewed" without introducing a second preview surface (the authenticated in-workspace Canvas remains the only preview, per the pre-existing capability contract — no public/anonymous preview was added).

### Tenant isolation / request shape

No new request ever carries `tenant_id` or any other authority field — verified by a dedicated client test that inspects every outgoing body. All requests use only `storefrontId`/`versionId` path segments, exactly mirroring the pattern already established by `presentation.ts`.

## Files changed

```
web/src/modules/commerce-workspace/presentation-versions.ts        (new) — API client
web/src/modules/commerce-workspace/presentation-versions.test.ts   (new)
web/src/modules/store-experience-builder/VersionSelector.tsx       (new)
web/src/modules/store-experience-builder/VersionManagerPanel.tsx   (new)
web/src/modules/store-experience-builder/ExperienceBuilder.tsx     (rewired: version state machine, save/switch/create/duplicate/rename/delete, Publish gating, Published read-only, preview banner, stale-callback guard)
web/src/modules/store-experience-builder/messages.ts               (+ ~50 ar/en message keys)
web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.test.tsx        (updated: version-API mocks replace legacy mocks)
web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.versions.test.tsx (new)
web/src/app/(commerce)/commerce/appearance/page.test.tsx           (updated: version-API mocks)
web/src/app/(commerce)/commerce/appearance/section-editing.test.tsx     (updated: version-API mocks + wait for hydration)
web/src/app/(commerce)/commerce/appearance/section-instances.test.tsx   (updated: version-API mocks + wait)
web/src/app/(commerce)/commerce/appearance/section-selection.test.tsx   (updated: version-API mocks + wait)
web/src/lib/mock-data.ts                                            (+ demo-mode mock CRUD for the version endpoints, dev-visual-QA only)
web/src/app/dev/customizer-versions/page.tsx                        (new, dev-only, NODE_ENV=production → 404) — visual-QA fixture
web/e2e/cust-h1-2-version-manager.spec.ts                           (new) — Playwright visual/behavioral verification
```

## API integration

Consumed exactly as delivered by CUST-H1-1, no changes:

| Action | Endpoint | Notes |
|---|---|---|
| List | `GET .../presentation/versions` | Returns summaries (no `config`) |
| Create / Duplicate | `POST .../presentation/versions` | Body: `{ name, source_version_id? }` — no client config injection |
| Read exact | `GET .../presentation/versions/{id}` | Returns full detail incl. normalized `config` |
| Save exact | `PUT .../presentation/versions/{id}` | Body: `{ config, revision }` |
| Rename | `PATCH .../presentation/versions/{id}` | Body: `{ name, revision }` |
| Delete | `DELETE .../presentation/versions/{id}` | 204, or 409 lifecycle conflict |

Error classification in the new client (`presentation-versions.ts`): 409 on read/create → `unsupported_schema` (forward-schema fail-closed); 409 on save/rename → `conflict` (stale revision or active-immutable — both resolved the same safe way: offer reload, never auto-merge); 409 on delete → `lifecycle_conflict`.

## Tests

Exact commands and results (all green, this session, `web/`):

```
npx vitest run src/modules/commerce-workspace/presentation-versions.test.ts   # 12 passed
npx vitest run src/modules/store-experience-builder/__tests__/ExperienceBuilder.test.tsx          # 14 passed
npx vitest run src/modules/store-experience-builder/__tests__/ExperienceBuilder.versions.test.tsx # 10 passed
npx vitest run "src/app/(commerce)/commerce/appearance"                       # 33 passed (5 files)
npm test -- --run   # full web suite: 312 files / 2171 tests passed
npx tsc --noEmit -p tsconfig.json   # zero errors in any file this PR touches (71 pre-existing errors elsewhere, unchanged, unrelated — verified identical count on a clean checkout of this branch's base)
npm run build        # next build — compiled + typechecked successfully, 177/177 pages generated
```

New test files: `presentation-versions.test.ts` (client mapping/classification/tenant-isolation, 12 tests), `ExperienceBuilder.versions.test.tsx` (10 tests: empty state + create, ambiguous choose state, list with state badges/long names, duplicate-from-Published, rename, delete with confirmation naming the version, delete lifecycle-conflict refresh, **stale-callback guard** for A→B switching, mobile Bottom Sheet switch). `ExperienceBuilder.test.tsx` was updated (not expanded) to mock the version endpoints in place of the retired legacy mocks, preserving every pre-existing assertion (SBC whitespace handling, no-localStorage-write, etc.) plus a new stale-revision-conflict-banner test (replacing the old auto-reload-on-409 test, since that behavior intentionally changed per §15 — reload is now an explicit merchant action, never silent). The three `appearance/section-*.test.tsx` files needed the same legacy→version mock swap (they render the real, storefront-connected `ExperienceBuilder`) plus an explicit wait for the mount-time version fetch to settle before interacting with panels — a genuine behavioral change from before this Horizon (ControlPanels only render once a version is resolved), not a workaround.

## Visual verification

Browser-based (Playwright, Chromium), against a new dev-only fixture (`/dev/customizer-versions`, `NODE_ENV=production` → 404) that mounts the **real** `ExperienceBuilder` behind the pre-existing local Demo mode, with an in-memory mock CRUD backing for the six version endpoints (`lib/mock-data.ts`) — no new screenshot infrastructure; reuses the same `/dev/*` + Playwright-spec + `test-results/` evidence pattern as `/dev/customizer-visual` and `/dev/trust-visual`.

Verified (`web/e2e/cust-h1-2-version-manager.spec.ts`, 6 scenarios, all passing headless Chromium):

- **Desktop 1440 AR** — toolbar selector shows name + state badge; manager popover opens with Open/Rename/Duplicate actions (Delete correctly hidden for the currently-open sole version).
- **Desktop 1440 EN** — a storefront with only a Published version auto-opens read-only; "Create a draft from this version" is the only mutation path; Save and Publish are both disabled.
- **Tablet 768 AR** — no horizontal overflow (this required a real fix — see Review findings).
- **Mobile 390 AR** — ambiguous multi-draft state shows no auto-selection; the mobile toolbar trigger opens the Version Manager as a Bottom Sheet; switching from it closes the sheet and updates the toolbar.
- **Mobile 430 EN** — six versions including Published/Scheduled/a very long name, inside the Bottom Sheet: no overflow, long name truncates with an ellipsis, sheet scrolls independently, Published/Scheduled states both visible and distinguishable by text label (not color alone).
- **Desktop 1280 AR stress case** — the same six-version/long-name set inside the desktop popover: no overflow.

Screenshots were captured to `web/test-results/cust-h1-2-version-manager/` during this session (not committed — build artifacts) and visually inspected; three genuine issues were found and fixed during this pass (see below).

## CI

Workflow: `.github/workflows/web-ci.yml` (`npm run test` then `npm run build`, Node 22). Both commands verified green locally under the same invocations CI uses. CI itself will run once the PR is opened; this report will be updated if it surfaces anything not reproducible locally.

## Review findings (self-review during implementation, pre-PR)

No external review has run yet (PR not yet open). Three real defects were found and fixed via the browser-based visual pass, which unit tests (jsdom, no real layout engine) could not have caught:

| Finding | Root cause | Fix | Regression coverage |
|---|---|---|---|
| Tablet (768px) horizontal overflow when the Version selector is present | The Dropdown's trigger button is `inline-flex` (content-sized) with no `min-width:0`/shrink control, and its `md:max-w-[220px]` cap only got *wider* exactly at the tablet breakpoint where the header has the least spare room | Tightened the trigger's responsive max-width (`max-w-[84px]` up to `md`, `lg:max-w-[220px]`), added `min-w-0`, hid the state-badge text below `lg` (state remains visible in the manager itself) | `e2e/cust-h1-2-version-manager.spec.ts` "tablet 768 AR" asserts `scrollWidth <= clientWidth`; verified 768/820/1024/1280/1440 all exact-fit before commit |
| Same Dropdown panel used `absolute` positioning with a fixed `24rem` width and no viewport containment, which could push the (closed or open) menu past the screen edge at narrower "desktop" widths (768–1023px, since real mobile uses a different, Bottom-Sheet code path entirely) | The shared `Dropdown` primitive's plain `absolute` mode assumes ample viewport width | Enabled the primitive's existing `mobilePopover` mode (viewport-clamped `fixed` positioning below `lg`) for this specific usage | Same test as above |
| A Playwright test asserting `html[dir]` failed — that attribute is owned by a different (platform) layout the dev fixture page doesn't render | Wrong assertion target, not a product bug | Asserted `[data-experience-builder]`'s own `dir` instead (the actual node this component controls) | n/a (test-only fix) |

All three fixes and their regression coverage are already in this commit; there is no separate "found in CI" round yet since CI has not run.

## Backward compatibility

- `GET/PUT/POST …/presentation` and `…/presentation/publish` (legacy compatibility endpoints) are untouched on the backend and are no longer called by the Customizer UI at all — any other consumer of those routes is unaffected.
- The pre-CUST-H1-2 "no storefront selected" local-editing mode (`ExperienceBuilder` with no `storefrontId`, e.g. momentarily during store-list load, or any future standalone preview use) renders `ControlPanels` exactly as before — verified by the unmodified-behavior tests in `ExperienceBuilder.test.tsx` (SBC round-trip, CR/VAT identity rendering, etc., none of which pass a `storefrontId`).
- Section editing/selection/instances tests (`appearance/section-*.test.tsx`) needed their mocks swapped from the legacy module to the version module, and an explicit wait added for the (now real, previously nonexistent) mount-time version fetch — the underlying section-editing behavior itself is unchanged; only the loading sequence gained a real async step.

## Tenant isolation

No frontend request body or path ever carries `tenant_id`/company id/authority flags in the new client, verified by an explicit test scanning every request made in a representative flow (create/save/rename). Storefront and version ids are used purely as path selectors, exactly matching the pattern the already-shipped `presentation.ts` establishes and CUST-H1-1's backend already enforces server-side (`TenantContext`, non-leaking 404s). This Horizon adds no new backend surface and therefore introduces no new isolation risk.

## Out of scope (confirmed not added)

- No immediate/exact Version-aware Publish endpoint or action — the Publish button is permanently gated/disabled with an explanatory message; no code path can reach the legacy publish endpoint from the new version-aware flow.
- No scheduling UI, no schedule/reschedule/cancel controls — Scheduled state is displayed read-only (name, "scheduled for" timestamp) exactly as the backend already reports it; no control implies scheduling can be created, changed, or cancelled from this Horizon.
- No Deploy / Production activation of any kind.
- No new backend endpoint, migration, or RBAC permission — 100% consumption of CUST-H1-1's existing contract.
- No public/anonymous preview route — preview remains the authenticated in-workspace Canvas exclusively.

## Risks / remaining work

- The Version Manager's per-row "Delete" client-side guard (`state === 'draft' && !selected`) is a defence-in-depth convenience, not a substitute for the server's own lifecycle checks (compatibility-working-version, which the API never exposes to the client) — a 409 there is expected, handled, and tested.
- Tablet width (768px) is visually tight (title and version name both truncate aggressively) once no-overflow is guaranteed; this is functional and matches the existing header's own pre-CUST-H1-2 truncation behavior at that width, but has less breathing room than desktop. Acceptable for this Horizon; worth revisiting if the toolbar grows further in CUST-H1-3+.
- No CI run has happened yet for this PR (about to be opened) — this report will need a follow-up note once CI reports back, per the monitoring/babysitting workflow.

## Next step

**CUST-H1-3 — Immediate Version Publishing**, per the architecture's implementation slicing (§30). CUST-H1-2 is not blocked; the Publish button's gating message and the `versionPublishGated` copy are written with CUST-H1-3 in mind and should be the first thing revisited when that Horizon lands.
