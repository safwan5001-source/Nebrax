# CUST-HV V5d-1 — Server publish contrast gate for section design — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5d-1** — first part of V5d (V5d-1 gate → V5d-2 ColourField + Content/Design/Layout inspector + copy/paste/reset + V1B items) |
| **Branch** | `cust-hv/v5d1-publish-contrast-gate` |
| **Base** | `origin/main` after V5c (#1268) |
| **Authority** | V0 §4.5.5–6 (the editor and the server run the identical algorithm; unproven = non-compliant), §3.2.1 |
| **Depends on** | V5a (engine) · V5b (contract) · V5c (resolver) |

V5c made a designed section render; nothing yet **stopped** a draft whose text is unreadable from reaching the live store. V5d-1 closes that: the same V5a engine, run over what the section will actually draw, now decides publishability on the server.

---

## Implemented

### `SectionDesignContrast` (PHP authority) — wired into `StorefrontPresentationPublishValidator::errors()`
The single place every publish path already calls (immediate, legacy head, schedule-time, dispatch-time), so there is no path that skips it.

- **What is judged is what is drawn.** `effectiveText` resolves the section's body / heading / link colours (explicit, else automatic white/black proven against the **whole** background range) and the interval they sit on:
  - section **background** (solid, or gradient over its full interior — never its two stops);
  - a section with explicit text colours but **no background** is judged against today's page background (`#f8f9fa`), so “white text on the page” cannot be published.
- Roles resolve exactly as the renderer does (palette → today's fixed tokens; accent derived when unset) — a PHP twin of `resolveRoleHex`, including half-up `mixHex` rounding.
- **Codes and paths (stable, per field the merchant fixes):**
  - `homepage.sections[i].design.text.<body|heading|link>` → `contrast_insufficient` (an explicit colour below 4.5:1);
  - `homepage.sections[i].design.background` → `contrast_unprovable` (an *automatic* foreground cannot be proven on that gradient — V5c's documented limitation: e.g. `#d1456a → #1e8b9a`; the background is what to change).
- **Hidden sections never block publishing** (they render nothing). A document with no `design` is untouched (no extra work, same errors as before).
- Any **solid** background with the automatic foreground is always publishable (tested over black, white, mid-grey and brand colours) — a merchant is never forced to pick a text colour.

### TS twin (web + storefront, byte-identical)
`effectiveText` gained `judged`; new `sectionContrastIssues(design, ctx)` and `PAGE_BACKGROUND`. Same algorithm, same codes, so V5d-2's inspector can show the verdict live and the server will agree.

### One shared fixture
`tests/Fixtures/presentation/section-design-contrast.json` (17 cases generated from the PHP authority) asserted by PHP and **both** TS apps (ratios at 1e-4): auto fg on dark/mid solid, explicit fail on body/heading/link, all three failing, page-background judging, the unprovable gradient, the **gradient-interior counter-example** (explicit black passes both endpoints, fails the interior), palette-resolved roles, fallback tokens, derived accent.

---

## Invariants

| Invariant | Status |
|---|---|
| Tenant Isolation / auth / RBAC | No route, model, query or migration — a pure function over the already-tenant-scoped document. |
| Draft vs Published | **A draft is never rejected**: saving keeps exactly what the merchant entered (tested); only publish/schedule fail, with a path-specific 422 (`publish_validation_failed`, `errors`, `error_codes`). |
| Concurrency | Untouched — the gate runs inside the existing publish/schedule flows. |
| Fail-closed | Unprovable ⇒ blocked (V0). |
| Commerce / accounting | Untouched. No journal entries. |
| Backward compatibility | No `design` ⇒ identical validator output; nothing in Production carries one; no API shape change (the same error envelope as V3/V2c). |

## Verification

| Gate | Result |
|---|---|
| PHP | `SectionDesignContrastTest` **24** (17 shared cases · exact paths · unprovable gradient on the background · hidden section · any solid bg publishable · immediate publish 422 + draft preserved + nothing published · legacy head + schedule 422 · a compliant design publishes and the snapshot carries it) |
| Web | `section-design-contrast.test.ts` **19** · resolver/contract suites 72 ✓ |
| Storefront | same 19 · `biome check` ✓ · `tsc` ✓ |
| Full backend (sqlite, local) | see PR |

## Limitations / next

- The gate judges **text colours over the section background**. Image/overlay regions arrive with V6 (region luminance); until then `background.kind = media` cannot exist in a document (dropped by V5b).
- Large-text (3:1) is not applied: every colour is judged at 4.5:1 (stricter, never unsafe).
- **V5d-2**: `ColourField` (role swatches, hex, recents, live contrast badge from `sectionContrastIssues`, “suggest foreground”), the Content / Design / Layout inspector, copy/paste style, reset design, and the V1B items.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
