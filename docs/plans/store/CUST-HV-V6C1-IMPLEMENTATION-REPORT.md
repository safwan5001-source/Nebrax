# CUST-HV V6c-1 — Banner display window — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6c-1** — first sub-slice of V6c (V6c-1 window → V6c-2 CTA model → V6c-3 placement grid + height presets → V6c-4 hero overlap + banner layout variants) |
| **Branch** | `cust-hv/v6c1-banner-window` (from `main` after V6b-5 #1281) |
| **Authority** | V0 §8.4 · D-15 (one window semantic, no second scheduler) · AMEND-7 (Draft keeps what was typed, Publish rejects, never silently "fixes") |
| **Scope** | Additive optional key `content.window {startsAt?, endsAt?}` on the Banner section. No migration, no API route change, `PRESENTATION_CONFIG_VERSION` stays 3. No accounting / commerce effect. |

---

## Decision: reuse the announcement window, do not invent a second one

The announcement bar already owns the only display-window semantic in the product (V3): UTC ISO instants, `startsAt` **inclusive**, `endsAt` **exclusive**, evaluated by `announcementWindowState`. The Banner uses that predicate, that parser, that editor component and that error vocabulary. Consequently there is **no** second scheduler, no cron, no job: the storefront config fetch is `no-store`, so the window is evaluated per request against the request clock.

## What was built

| Layer | Change |
|---|---|
| **PHP authority** `StorefrontPresentationNormalizer` | Banner `content` gains `window` (last key — key order is part of the shared fixture). Edge strings are trimmed and bounded (40 code points) but **never validated or dropped at normalisation**: a Draft keeps exactly what the merchant typed, even malformed. A window alone does not revive an otherwise empty banner. Only `banner` accepts the key. |
| **PHP publish gate** `StorefrontPresentationPublishValidator` | New `bannerWindowErrors()` over **visible** banners only (a hidden banner is never shown, so it cannot block). Path-specific 422: `homepage.sections[i].content.window.startsAt|endsAt`, codes `window_invalid_timestamp` and `window_end_not_after_start` (equal edges ⇒ empty window ⇒ rejected). Never normalised to "no window" — that would make a broken banner *more* visible. |
| **Twins** (`web` + `storefront`: `announcements.ts`, `section-content.ts`) | Shared `normalizeWindowEdges()` used by announcements and banners, so the twins stay byte-identical; `BannerContent.window?`. |
| **Storefront render** `published-nodes.tsx` | A banner outside its window — or with an invalid one (fail-closed) — is **omitted entirely**: no wrapper, no backdrop, no leftover spacing. `ctx.nowMs` is injectable for tests; default is the request clock. Neighbouring sections are untouched. |
| **Merchant editor** | `WindowFields` extracted from `AnnouncementsPanel` into the shared `WindowFields.tsx` (scope id + window instead of an announcement item); Banner inspector uses it. Entered as wall-clock in the **store's** zone (`/me → company.timezone`, threaded through `HomepagePanel`), stored as the exact UTC instant; a half-filled edge is held locally and never written. A banner with nothing to show offers no window (the normaliser would discard it) and says why. |
| **Canvas** | The banner stays **visible and selectable**; an editor-only chip (`data-banner-window-status` = scheduled / expired / invalid) states what the storefront will do. One clock (`useWindowsClock`) re-evaluates at the next edge, so an editor left open across a boundary stays truthful. Home page only. |
| **Publish feedback** | `describePublishIssues` now reads banner window paths: "Cannot publish: … Banner: the end must be after the start". Unknown codes never leak. AR + EN copy added (`bannerWindow*`, `bannerLabel`). |

## Review findings resolved (Codex, P2 ×2)

| Finding | Verdict | Fix |
|---|---|---|
| `zonedWallTimeToUtcIso` read the offset at the wall time *as UTC*, so a DST-zone merchant entering `2026-03-08 03:30` in `America/New_York` stored `08:30Z` (04:30 local) | **Real**, pre-existing in the shared helper (also used by version scheduling); invisible in `Asia/Riyadh` | Offset is now resolved at the resulting instant with a round-trip check (candidates from the offsets a day either side). Repeated hour ⇒ first occurrence; skipped hour ⇒ just after the gap. Non-DST zones unchanged. Tests: both 2026 NY transitions, a half-hour round-trip sweep, Riyadh unchanged. |
| PHP gate compared Carbon instants at µs precision while the runtime (JS `Date`) truncates to ms, so `.000001Z → .000002Z` passed publish but hid the banner forever | **Real** (also latent for announcements) | `parseInstant` truncates to ms like the runtime, so equal-at-ms edges are rejected with `window_end_not_after_start`. Tests added for µs and sub-ms edges; valid 1 ms window still passes. |

## Invariants

| Invariant | Status |
|---|---|
| Draft vs Published | Draft keeps malformed windows verbatim (API test: PUT → GET returns the bad window); publish refuses with 422, **nothing** is written to `published_config`; fixing the same draft then publishes and the snapshot carries the window. |
| Tenant isolation / authN / authZ / concurrency | Untouched — same endpoints, same `revision` / `expected_published_revision` checks. |
| Backward compatibility | `window` absent ⇒ byte-identical normaliser output, identical render (test: neighbours untouched, no chip). Existing published snapshots without the key behave as before. |
| Fail-closed | Invalid window ⇒ storefront hides the banner; gate blocks publish. |
| Accounting / commerce truth | No financial behaviour ⇒ no journal entries. |
| Media ownership | Untouched. |
| No arbitrary CSS/JS/HTML | The window is two bounded ISO strings. |

## Design Quality Pass

- The control is the **same fieldset** merchants already know from announcements (date + time + Clear per edge, zone label, inline alert), so no new interaction pattern to learn. Touch targets keep the shared 40 px inputs; fields stack at 390/430 and in the 320-wide inspector; no horizontal overflow (inputs are `min-w-0`).
- `type="date"`/`"time"` inputs are forced `dir="ltr"` so digits never reorder in RTL; the labels and hint are AR/EN.
- States covered: empty banner (explains why no window), half-filled edge (warning), unreadable stored value (negative), inverted/malformed (alert, role=alert), scheduled/expired/invalid chip on Canvas (`role="status"`), open window (no chip).
- Keyboard: native date/time inputs and a real Clear button — no custom widgets.

## Tests

| Suite | Result |
|---|---|
| `StorefrontPresentationBannerWindowTest` (shared fixture + gate + API draft/publish round-trip) | passed |
| Shared fixture `banner-window.json` | consumed by PHP, web and storefront tests (identical output incl. key order) |
| Storefront `published-nodes.banner-window` (inside/before/after, inclusive start, exclusive end, offsets, malformed/inverted fail-closed, no wrapper, default clock) | passed |
| Web `ControlPanels.banner-window` (UTC conversion in UTC+3, clear removes key, inverted alert, empty banner, Canvas chip states + edge flip with fake timers, publish copy) | passed |
| `web` `store-experience-builder` | 73 files / 1151 tests passed |
| `storefront` full | 157 files passed (+1 env-gated skipped) / 1553 tests |
| `tsc` (changed modules) / `biome` (changed files) | clean |
| Full `php artisan test` | see PR |

## Limitations (stated)
- The window is **per Banner section**; multiple banners each have their own. There is no shared campaign object (V0 §8.4 does not require one).
- Times are minute-precision in the editor (native time input); stored values may carry seconds/millis if set through the API, and are honoured exactly.
- No pixel proof is needed: the omitted banner leaves no DOM, and the present one renders through the unchanged V6b path.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
