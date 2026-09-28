# CUST-H1-2 — Version-aware Customizer UX — Implementation Report

## Status

**READY FOR MERGE — OWNER APPROVAL REQUIRED**

## Repository state

- **Base SHA:** `2e9cdd058a50a2014dc0b4a3c5c0c3302c353616` (`origin/main` at task start — matched the SHA given in the task brief; verified with a fresh `git fetch origin main` before starting).
- **Head SHA:** `992d39b` (post-round-7-review-fix; round-6 fix head was `9a4209d`; round-5 fix head was `01a4981`; round-4 fix head was `c2033dd`; round-3 fix head was `892e1e1`; round-2 fix head was `0e3111c`; round-1 fix head was `fddba52`; initial implementation head was `3077ecf`)
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
npx vitest run src/modules/store-experience-builder/__tests__/ExperienceBuilder.versions.test.tsx # 13 passed (10 + 3 review-fix regressions)
npx vitest run "src/app/(commerce)/commerce/appearance"                       # 33 passed (5 files)
npm test -- --run   # full web suite: 312 files / 2174 tests passed (post review-fix round)
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

## Review findings

### Self-review during implementation (pre-PR)

Three real defects were found and fixed via the browser-based visual pass, which unit tests (jsdom, no real layout engine) could not have caught:

| Finding | Root cause | Fix | Regression coverage |
|---|---|---|---|
| Tablet (768px) horizontal overflow when the Version selector is present | The Dropdown's trigger button is `inline-flex` (content-sized) with no `min-width:0`/shrink control, and its `md:max-w-[220px]` cap only got *wider* exactly at the tablet breakpoint where the header has the least spare room | Tightened the trigger's responsive max-width (`max-w-[84px]` up to `md`, `lg:max-w-[220px]`), added `min-w-0`, hid the state-badge text below `lg` (state remains visible in the manager itself) | `e2e/cust-h1-2-version-manager.spec.ts` "tablet 768 AR" asserts `scrollWidth <= clientWidth`; verified 768/820/1024/1280/1440 all exact-fit before commit |
| Same Dropdown panel used `absolute` positioning with a fixed `24rem` width and no viewport containment, which could push the (closed or open) menu past the screen edge at narrower "desktop" widths (768–1023px, since real mobile uses a different, Bottom-Sheet code path entirely) | The shared `Dropdown` primitive's plain `absolute` mode assumes ample viewport width | Enabled the primitive's existing `mobilePopover` mode (viewport-clamped `fixed` positioning below `lg`) for this specific usage | Same test as above |
| A Playwright test asserting `html[dir]` failed — that attribute is owned by a different (platform) layout the dev fixture page doesn't render | Wrong assertion target, not a product bug | Asserted `[data-experience-builder]`'s own `dir` instead (the actual node this component controls) | n/a (test-only fix) |

### Automated review (`chatgpt-codex-connector`, round 1, reviewed `743f5b6`, fixed in `fddba52`)

Three P1 findings, all real, same underlying class of bug (a previous version/store's identity leaking into the currently-displayed one across an async boundary) but at three different points in the version lifecycle my own stale-callback guard (§28) hadn't yet reached:

| Finding | Fix | Regression test |
|---|---|---|
| Switching `storefrontId` without remounting `ExperienceBuilder` (e.g. a multi-store merchant changing the active store) left the previous store's `selectedVersion`/`draft`/`versions` in place; if the new store had zero or several candidates (no auto-select), the old version stayed displayed *and editable*, so a Save would send its id under the new store's path. | The `[storefrontId]` effect now synchronously resets `selectedVersion`, `versions`, `draft`, `saved`, and bumps the shared request-invalidation token *before* starting the new store's load. | `switching storefrontId resets the previous store's version state instead of leaking it` |
| A rename conflict (409) on the version currently open in the editor only refreshed the manager's row summaries, not the open editor's `draft`/`selectedVersion`. A retry could succeed against the now-correct row revision while `draft` stayed on stale content, so a subsequent Save would pass optimistic concurrency and silently overwrite another session's edit. | A conflict on the *currently selected* version now raises the same explicit-reload `versionConflict` banner used for save conflicts, and both `handleSave`/`handleRenameVersion` refuse to run against that version until the merchant explicitly reloads its full detail. A conflict on a row that isn't open still just refreshes the list, as before. | `a rename conflict on the currently open version blocks further save/rename until an explicit reload` |
| Starting a Save on version A, then switching to version B while the `PUT` was still in flight, let A's later-arriving success response unconditionally restore A's config/selection — discarding whatever the merchant had already done on B. | `handleSave` now captures the shared request token before awaiting the `PUT` and re-checks it on completion; a save superseded by an intervening switch still syncs that version's entry in the manager's list (so its revision/updated-at stay correct) but never touches `draft`/`saved`/`selectedVersion` again. | `a save that resolves after the merchant switches to another version does not overwrite it` |

All three review threads were replied to individually (naming the fix commit) and resolved. `npm test -- --run` (2174 tests, full suite) and `npm run build` both re-verified green after this round.

### Automated review (`chatgpt-codex-connector`, round 2, reviewed `8075d9d`, fixed in `0e3111c`)

Two more P1 findings and one P2, the same class of stale-identity-across-an-async-boundary bug as round 1, at three lifecycle points the round-1 fix hadn't reached yet: rename completion, create/duplicate completion, and list loading.

| Finding | Fix | Regression test |
|---|---|---|
| A rename for the currently-open version A completing after the merchant had already opened B still restored A's metadata into `selectedVersion` (the async closure's `selectedVersion` reference is stale by the time the response arrives) — a subsequent Save could then write B's edited config into A under the revision the rename returned. | `handleRenameVersion` now captures `wasOpenAtStart = selectedVersion?.id === version.id` *before* the `await`, and combines it with the existing token/storefront `stillCurrent()` check: `setSelectedVersion` (success path) and the conflict-reload banner (conflict path) only fire when both hold. `handleDeleteVersion` got the same treatment for consistency. | `a rename that completes after switching to another version does not overwrite it (codex round 2)` |
| `handleCreateVersion`/`handleDuplicateVersion` didn't capture the originating store/token before their `POST`, so `adoptCreatedVersion` unconditionally force-opened the new version even if the merchant had switched to a different store or a different version while the request was in flight — discarding whatever they'd started editing there. | Both handlers now capture `originStorefrontId`/`tokenAtStart` up front and branch three ways on completion: a different store now → drop the result; same store but a different version now open → update the manager's list entry only, never force-adopt; still current → adopt normally. | `a create superseded by a version switch updates only the manager list, not the open editor` |
| `loadVersionList` committed `setVersions`/`setVersionsListState` unconditionally once the list request resolved — the round-1 token bump protected detail (`show`) requests but not list requests, so a slower store's list response could still overwrite a newer store's list after a fast `storefrontId` switch. | `loadVersionList` now captures the originating storefront/token before the `await` and checks both via the same `stillCurrent()` helper immediately before committing state; a stale response is dropped instead of applied. | `switching storefronts before a slower store's list response arrives never lets it overwrite the new store's list` |

All three review threads were replied to individually (naming the fix commit `0e3111c`) and resolved. `npx vitest run` (2177 tests, full suite) and `npm run build` both re-verified green after this round.

### Automated review (`chatgpt-codex-connector`, round 3, reviewed `81abebc`, fixed in `892e1e1`)

Two more P1 findings and one P2 — not the stale-callback-identity class this time, but two related gaps: destructive actions that skip an existing safety prompt, and a success handler that doesn't account for further user input made while its own request was in flight.

| Finding | Fix | Regression test |
|---|---|---|
| `handleCreateVersion`/`handleDuplicateVersion` adopted the new version into the editor unconditionally, silently discarding unsaved edits on whatever version was open — `selectVersion` already confirms this exact kind of discard before switching, but create/duplicate never did. Duplicate is worse: the server copies the last *persisted* config, not the local draft, so the discarded edits aren't even recoverable from the new version. | Both handlers now check the same `dirty` flag and show the same `versionSwitchDiscardConfirm` prompt *before* firing the request at all (not just before adopting the response) — declining leaves the open version's draft untouched and never calls the API. | `creating a new version while the open one has unsaved edits requires confirming the discard first (codex round 3)`, `duplicating a version while the open one has unsaved edits requires confirming the discard first (codex round 3)` |
| `handleSave`'s success path replaced `draft` with the config it had just submitted, even if the merchant kept editing after clicking Save but before the `PUT` resolved (nothing in the UI blocks further edits during a save) — silently losing those newer edits. | `handleSave` now captures the draft at submission time and compares it (via a `draftRef` synced every render) to the current draft once the response arrives. Only replaces `draft` with the server's echo if they still match; otherwise updates `saved`/`selectedVersion` (so the next save carries the correct revision) and leaves the newer, still-dirty draft in place. | `does not discard an edit made while an earlier save is still in flight (codex round 3)` |
| `EmptyVersionsPrompt`'s Enter-key handler fired `onCreate` unconditionally, unlike the adjacent submit button which already disables on `creating` — holding/repeating Enter during the first create could fire multiple POSTs. | The key handler now gates on `!creating` too. | `pressing Enter repeatedly while the first create is still pending does not send duplicate requests (codex round 3)` |

All three review threads were replied to individually (naming the fix commit `892e1e1`) and resolved. `npx vitest run` (2181 tests, full suite) and `npm run build` both re-verified green after this round.

### Automated review (`chatgpt-codex-connector`, round 4, reviewed `c1d8396`, fixed in `c2033dd`)

One more P1 and two P2 findings, both extensions of round 3's fixes: the discard-confirm guarded the *start* of create/duplicate but not edits made *during* the request, and the busy-flag bookkeeping around create/duplicate/rename/delete had the same "clear unconditionally, check ownership after" ordering bug in four places.

| Finding | Fix | Regression test |
|---|---|---|
| Round 3's discard-confirm only ran once, before the create/duplicate request started. If the draft was clean at that point but the merchant kept editing the still-open version while the `POST` was in flight (no switch occurred, so the request token never moved), the successful response still force-adopted the new version and silently discarded that edit. | `handleCreateVersion`/`handleDuplicateVersion` now also compare the draft at completion time against the draft at submission time (same pattern as `handleSave`'s round-3 fix). A mismatch is treated like a superseding switch: only the manager's list entry is synced, `adoptCreatedVersion` is skipped, and the edit survives. | `an edit made while a create is still pending is not discarded when the create resolves (codex round 4)` |
| `adoptCreatedVersion` invalidates the shared request token (correctly orphaning any in-flight save for the version being replaced) but never reset the generic `busy` flag. A save left pending under the replaced version would resolve, see a stale token, and correctly skip its own state updates — but also skip `setBusy(null)`, leaving the newly adopted version's Save button disabled until the merchant switched away and back. | `adoptCreatedVersion` now resets `busy` to `null` itself when it adopts. | `adopting a newly created version clears a still-pending save's stuck busy state (codex round 4)` |
| `handleCreateVersion`/`handleDuplicateVersion`/`handleRenameVersion`/`handleDeleteVersion` all cleared their own busy flag (`versionCreating`/`versionBusy`) unconditionally right after their request resolved, before checking whether the response still belonged to the currently displayed storefront. A slower request for a previous store could therefore clear a newer store's own in-flight flag, re-enabling its controls mid-request. | All four now compute `sameStorefront` first and only clear the flag when it holds. | `a create for a previous storefront resolving late does not clear a newer storefront's own creating flag (codex round 4)` |

All three review threads were replied to individually (naming the fix commit `c2033dd`) and resolved. `npx vitest run` (2184 tests, full suite) and `npm run build` both re-verified green after this round.

### Automated review (`chatgpt-codex-connector`, round 5, reviewed `c8ca73f`, fixed in `01a4981`)

Three more P2 findings — a second Enter-key gate the round-3 fix missed, a delete/open race the round-1/2 identity guards didn't cover, and a second-await staleness bug in the same family as round 4's list-loading fix.

| Finding | Fix | Regression test |
|---|---|---|
| Round 3 only gated `EmptyVersionsPrompt`'s Enter handler. `VersionManagerPanel` has its own, separate create form with its own Enter handler and `submitCreate()` — neither checked `creating`, so reopening the form (the "+ نسخة جديدة" toggle has no guard either) and pressing Enter while an earlier create was still pending fired a second `POST`. | `submitCreate()` now checks `creating` itself before doing anything else, closing the same gap the round-3 fix closed for the other form. | `pressing Enter to submit a reopened manager create form while an earlier create is pending does not send a duplicate request (codex round 5)` |
| A row's delete-confirmation UI clears the instant the merchant confirms, before the `DELETE` itself resolves, so its "Open" button reappeared enabled while the row was still being deleted. Opening it then raced the delete: the version's `GET` could complete after the confirm but the row still get deleted server-side, leaving the editor pointed at a version that no longer exists (a later Save would 404). | "Open" is now also disabled while `busy === "delete"` for that row, not just while `switching`. | `opening a version while its own delete is still pending is blocked (codex round 5)` |
| `handleRenameVersion`'s conflict branch computed `current`/`sameStorefront` once, then awaited its own list refresh, then reused those pre-refresh values afterward — the same "value computed before a second `await`, reused after it" bug round 4 fixed in `loadVersionList`. A storefront switch mid-refresh could install the conflict banner (and its discard-on-reload action) over the new store's unrelated, freshly opened version. | The storefront/token identity is now re-checked from the live refs immediately after `loadVersionList()` resolves, not reused from before it started. | `switching storefronts while a rename-conflict's list refresh is pending does not apply the conflict to the new store (codex round 5)` |

All three review threads were replied to individually (naming the fix commit `01a4981`) and resolved. `npx vitest run` (2187 tests, full suite) and `npm run build` both re-verified green after this round.

### Automated review (`chatgpt-codex-connector`, round 6, reviewed `5bc6d32`, fixed in `9a4209d`)

Three more P2 findings extending the round-4/5 patterns to row-write serialization and the retry/reload paths, plus one finding deliberately deferred rather than fixed.

| Finding | Fix | Regression test |
|---|---|---|
| `versionBusy` is a single shared slot across all rows (one row operation at a time, by design). Starting a rename/duplicate on row A while row B's delete was in flight silently stole the slot, so B's Open button re-enabled mid-delete — the same risk the round-5 fix addressed, just reachable through a second row instead of a storefront switch. | Row action buttons (Open, Duplicate/Rename/Delete triggers, and their inline submit/confirm buttons) are now also disabled on every *other* row while any row has a delete in flight, scoped specifically to `busyAction === "delete"` — the one case where losing the busy signal risks the editor pointing at a removed document. Switching versions or renaming elsewhere while a non-delete op is pending remains supported (already tested). | `a pending delete on one row blocks starting a new write on another row until it settles (codex round 6)` |
| The list-load "retry" action only refreshed the row data — the deterministic single-candidate auto-selection logic lived exclusively in the mount effect, so a successful retry on a store with exactly one eligible draft left nothing open and the original error notice still showing. | Extracted the mount effect's load-then-select flow into `loadAndSelectInitialVersion()`, reused by both the manager panel's and the inspector body's retry actions. | `a successful retry after a failed initial list load auto-selects a single eligible version and clears the stale error (codex round 6)` |
| `handleDeleteVersion`'s lifecycle-conflict branch had the same "value computed before a second `await`, reused after it" bug the previous round fixed in the rename-conflict branch — a storefront switch during its own list refresh could apply store A's delete-conflict notice to store B's editor. | Re-checks the live storefront ref after `loadVersionList()` completes, same as the rename-conflict fix. | `switching storefronts while a delete-conflict list refresh is pending does not apply the notice to the new store (codex round 6)` |
| `formatDateTime` renders `scheduledFor` in the browser's local timezone with no authoritative store timezone supplied. | **Deliberately deferred, not fixed** — replied on the thread rather than pushing a change. `src/lib/formatting.ts` explicitly documents *"without inventing a new timezone policy"*; hardcoding a timezone (Asia/Riyadh, the only real candidate given this product's Saudi-specific ZATCA/VAT/chart-of-accounts scope) for only this one field would create an inconsistency with every other timestamp in the same row and app, and no tenant/store timezone field exists in the data model to do it properly. This is a product decision (does Nebrax need an authoritative per-tenant timezone, and where would it live) that belongs with the repo owner, not something to guess at as a side effect of one row's label. | n/a — thread left open for the owner |

Three of the four review threads were replied to individually (naming the fix commit `9a4209d`) and resolved; the timezone thread was replied to explaining the deferral and left **unresolved** for the owner's attention. `npx vitest run` (2190 tests, full suite) and `npm run build` both re-verified green after this round.

### Automated review (`chatgpt-codex-connector`, round 7, reviewed `5bc6a14`, fixed in `992d39b`)

One more P1 and two P2 findings — the round-6 row-write serialization fix was still too narrow (only guarded against a *delete* being masked, not any operation, and only in one ordering), and a genuinely new race in plain version-switching (not row actions) that no earlier round's guards covered.

| Finding | Fix | Regression test |
|---|---|---|
| The editor for the currently-open version stays fully editable while switching to another version's `GET` is in flight (no editing lock during a switch). An edit made in that window doesn't bump the request token (only a further switch does), so `applyVersionSelection`'s unconditional assignment on success silently replaced it once the target resolved. | Captures the draft when the switch begins and compares it to the current draft (via `draftRef`) once the target resolves — same pattern as the round-3/4 save/create fixes. A mismatch updates only the target's list entry instead of forcing it open, leaving the newer edit in place. `reloadConflictedVersion()` opts back into the old unconditional behavior via a new `allowOverwriteDuringFetch` flag, since an explicit "reload version" click is itself a discard-and-refetch action. | `an edit made to the still-open version while switching to another is not discarded when the switch resolves (codex round 7)` |
| Round 6 only blocked starting a new row write when the *existing* shared-slot operation was specifically a delete. The reverse ordering still worked: a rename starting first, then a delete starting on another row (not blocked, since the existing op wasn't a delete), followed by the rename completing and unconditionally clearing the shared slot — hiding the still-in-flight delete's own busy state and re-enabling that row's Open button. | Widened the guard to block a new row write whenever *any* other row has one in flight, regardless of which operation. "Open" stays exempt from this guard (it doesn't touch the shared slot, and switching during an unrelated row write is supported and already tested). | `a pending rename on one row blocks starting a delete on another until it settles (codex round 7)` |
| A row's Duplicate/Rename/Delete triggers weren't disabled while that same row's own version was still being fetched (`switching`) — only "Open" was. Opening a version, then reopening the manager to delete that same row before its `GET` resolved, could delete a version the `GET` was about to select. | Duplicate/Rename/Delete triggers now also disable while `switching` is true for that row, matching "Open"'s existing guard. | `deleting a version whose own switch is still loading is blocked (codex round 7)` |

All three review threads were replied to individually (naming the fix commit `992d39b`) and resolved. `npx vitest run` (2193 tests, full suite) and `npm run build` both re-verified green after this round.

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

- **Owner decision needed:** the Scheduled row's "scheduled for" timestamp renders in the browser's local timezone (round-6 review finding, thread left unresolved on the PR — see that subsection above). Fixing it properly needs a decision on whether Nebrax should have an authoritative per-tenant timezone at all and, if so, where it's sourced from; not something this Horizon should decide unilaterally by hardcoding one into the shared formatter.
- The Version Manager's per-row "Delete" client-side guard (`state === 'draft' && !selected`) is a defence-in-depth convenience, not a substitute for the server's own lifecycle checks (compatibility-working-version, which the API never exposes to the client) — a 409 there is expected, handled, and tested.
- Tablet width (768px) is visually tight (title and version name both truncate aggressively) once no-overflow is guaranteed; this is functional and matches the existing header's own pre-CUST-H1-2 truncation behavior at that width, but has less breathing room than desktop. Acceptable for this Horizon; worth revisiting if the toolbar grows further in CUST-H1-3+.
- No CI run has happened yet for this PR (about to be opened) — this report will need a follow-up note once CI reports back, per the monitoring/babysitting workflow.

## Next step

**CUST-H1-3 — Immediate Version Publishing**, per the architecture's implementation slicing (§30). CUST-H1-2 is not blocked; the Publish button's gating message and the `versionPublishGated` copy are written with CUST-H1-3 in mind and should be the first thing revisited when that Horizon lands.
