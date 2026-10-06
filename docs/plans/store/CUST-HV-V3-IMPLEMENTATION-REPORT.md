# CUST-HV V3 — Announcement Bar — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V3** — Announcement bar (V0 §12): contract ×3, Canvas + Published, ticker / rotation / sticky / dismiss, window + targeting, a11y, parity |
| **Branch** | `cust-hv/v3-announcement-bar` |
| **PR** | see PR description (opened with this report) |
| **Base SHA** | `a5b3ff464d5c727044bec50568e1cef70b341604` (`origin/main` after V1A #1252 and V2a #1255) |
| **Head SHA** | the PR head (this report is part of it) |
| **Authority** | V0 contract §12, §4.5 (contrast), §11.4 (icon registry origin), AMEND-7 (window validation), AMEND-12; Master Execution §6 (V3) |
| **Depends on** | V0 only. Independent of V2 (no media in this slice) and of V4/V5. |

---

## Implemented capabilities

**One contract, three implementations held together by one fixture.** `announcements` is an optional, additive key in the presentation document (`PRESENTATION_CONFIG_VERSION` stays 3; emitted only when non-null). PHP (`StorefrontPresentationNormalizer`, the authority), the web twin and the storefront twin are byte-identical in logic and pinned by `tests/Fixtures/presentation/announcements.json` (normaliser cases, contrast ratios, automatic foreground, window evaluation) — none can drift silently.

| Area | Behaviour |
|---|---|
| **Document** | `{enabled, items[≤5], behaviour?}`. Item: `id`, `text` (≤120 code points, control characters flattened, plain text only), `enabled`, `icon?` (12-key curated registry — the origin of V0 §11.4; keys are append-only), `href?` (internal `/path` or safe `https` only), `surface?` (solid background + optional text/link colour), `window?` (`startsAt`/`endsAt`, kept verbatim), `pages?` (`home`/`product`/`category`; absent = every eligible page). Behaviour: `rotate`(+`rotateInterval` 6/8/10 s), `ticker`(+`tickerSpeed`), `sticky`, `dismissible`. A ticker excludes rotation — one rule, mirrored in all three. |
| **Eligibility** | `enabled ∧ item.enabled ∧ text ≠ "" ∧ window open ∧ page match`; default display = first eligible item. `startsAt` inclusive, `endsAt` exclusive. A malformed or inverted window is *invalid* and **never eligible** — it is never read as "no window". Cart / checkout / account / auth / unknown routes fail closed: no bar, whatever `pages` says. |
| **Draft vs Publish (AMEND-7)** | Draft preserves whatever the merchant entered (including an inverted window or an unreadable colour pair). **Publish, schedule and scheduled-dispatch** run `StorefrontPresentationPublishValidator` and fail closed with a path-specific `422` (`announcements.items[2].window.endsAt`, stable `error_codes`): `announcement_text_required`, `window_end_not_after_start`, `window_invalid_timestamp`, `contrast_insufficient`. One bad item blocks only its own path. A scheduled publish that turns invalid between scheduling and dispatch is rejected (`OUTCOME_VALIDATION_REJECTED`) and logged, never silently published. |
| **Contrast (§4.5)** | ≥ 4.5:1 for normal text. A custom background always gets a provably readable text: the merchant's choice if it passes, otherwise the automatic foreground. The editor shows the live ratio; Publish refuses a custom pair that fails. |
| **Storefront component** | `AnnouncementBar` (client): rotation with prev/next/pause/play, ticker marquee (per-speed minimum durations, RTL-aware direction, pause control, static under `prefers-reduced-motion`), sticky bar publishing `--store-announcement-height` so the sticky header offsets exactly, collapse-on-scroll-down on handheld widths (the bar never stacks with a sticky header on < `md`, V0 §12), `inert` while collapsed, per-browser dismissal `awj.ann.<id>.<contentHash>` (no tenant/user id, no server call; session-only if storage is unavailable), window boundaries re-evaluated by timer (clamped), no server clock baked into markup beyond the initial `serverNow`. i18n for all six storefront locales (`pnpm check:locales` parity). |
| **Builder — panel** | New **Announcement bar** inspector panel (`AnnouncementsPanel`): master switch; ≤5 messages with keyboard-operable move up/down/remove; per-message status chip (live / disabled / scheduled / expired / invalid window / no text); text with live counter; icon; link with validity hint; store-colour vs custom colour with auto/custom text and a live contrast readout; display window entered as **store-timezone wall time** (never the browser's) and stored as an exact UTC instant (half-filled edges are held locally, never written); page targeting; behaviour toggles (rotate + interval, ticker + speed, sticky, dismissible). |
| **Builder — Canvas** | `AnnouncementPreview` renders the first message that would be eligible on the page being previewed (same predicate, same icon registry, same surface resolution as the storefront), selectable like the other chrome (click or the keyboard button), with a clearly marked editor-only line naming rotation/ticker/sticky/dismiss and the count of hidden messages. The Canvas stays still while editing; real motion is proven in the storefront component. A sticky bar offsets the sticky Canvas header by the exact preview height. |
| **Publish UX** | The publish/schedule 422 now reaches the merchant as one sentence per problem — *"Cannot publish: announcement bar problem. Message 2: the end must be after the start"* — instead of the generic failure notice (`describePublishIssues`; unknown codes fall back to the headline, never raw server text or a code). |

---

## UX improvements (Design Quality Pass)

| Check | Result |
|---|---|
| Primary action clarity | One switch at the top; **Add message** is the only primary affordance; the list rows carry status, not controls the merchant must hunt for. |
| Canvas dominance | The bar is one 36 px strip above the header; editor-only text is a small dashed line, never inside the bar. |
| Grouping / editing speed | Message list → one expanded editor at a time (accordion) → behaviour grouped separately, global to the bar. A new message opens expanded. |
| Mobile / touch targets | List rows, reorder/remove, toggles and page checkboxes are ≥ 44 px (`min-h-11`). Date, time and **Clear** stack so nothing clips at 390 px (found and fixed during evidence — the first layout put date + time in one row and clipped the time field at 300 px panels). |
| 768 px | See *Risks / deferred*: below `lg` main has **no inspector surface at all** (DEF-7, owned by V1B). V3 does not paper over it; the Canvas shows the bar. |
| AR RTL / EN LTR | Both locales verified at six widths; LTR islands (`dir="ltr"`) for hex, link, date and time fields; text counter and chips follow logical direction. |
| Long labels / empty / error states | Empty list message; 5-message limit stated; invalid link, inverted window, half-filled window, unreadable stored value and failing contrast each have a specific inline message. |
| Keyboard / focus | Every control is a native button / input / select / checkbox; accordion rows expose `aria-expanded`; contrast readout is `role="status"`, inverted window is `role="alert"`. |
| Horizontal overflow | None added at any of the six widths (the builder shell itself overflows by 1 px at every width on `main`, measured before any interaction; the spec asserts V3 adds nothing to that baseline). |
| AWJ consistency | Uses the existing `Field` / `Section` / `Toggle` / `Segmented` primitives and **semantic tokens only** (the repo's drift ratchet and Admin↔Storefront boundary tests enforced this — see *Review / gate findings*). |
| Restrained motion | Bar rotation = fade; ticker = one linear marquee; nothing animates in the editor; reduced-motion resolves to static; autoplay always has a visible pause. |
| Merchant terminology | "Announcement bar", "message", "display window", "pin to top of page" — no "item", "document", "hex" in merchant copy. |

**One small IA addition, deliberately minimal:** the phone **Design** sheet used to be the Theme panel and nothing else, so every other panel — Announcements included, which has *no Canvas element to tap until it is switched on* — was unreachable below 768 px. The sheet now carries the same panel `<select>` the dormant edit pane already contains (`data-design-panel-select`). No new navigation concept; it also makes WhatsApp, Social, Contact etc. reachable on phones.

---

## Files changed (summary)

- **Backend:** `StorefrontPresentationNormalizer` (+216), new `StorefrontPresentationPublishValidator`, new `PresentationPublishValidationException`; wired into `StorefrontPresentationVersionService` (publish, schedule, scheduled dispatch), `StorefrontPresentationService` (legacy publish), `ScheduledPresentationDispatcher`, both presentation controllers (422 payload).
- **Web:** `presentation/announcements.ts` (+ config/index), `AnnouncementsPanel`, `AnnouncementPreview`, `announcement-icons`, `announcement-status`, `ControlPanels`, `ExperienceBuilder`, `StorefrontPreviewCanvas`, `messages.ts` (AR + EN), `commerce-workspace/presentation-versions.ts` (publish-gate issues on 422).
- **Storefront:** `lib/presentation/announcements.ts` (+ config/index), `AnnouncementBar`, `globals.css`, `Header`, `MobileMenu`, layout, six locale files, dev visual fixture `/dev/announcement-visual` (404 in production).
- **Tests/evidence:** fixture `announcements.json`, `StorefrontPresentationAnnouncementsTest`, storefront + web unit tests, `web/e2e/cust-hv-v3-announcements.spec.ts`, `docs/plans/store/cust-hv-v3/*.jpg`.

---

## Verification

| Gate | Result |
|---|---|
| PHP focused | `StorefrontPresentationAnnouncementsTest` **41** (normaliser, fixture parity, contrast, windows, API draft-preserve, publish 422, legacy publish, schedule 422, scheduled-dispatch fail-closed) + every `StorefrontPresentation*` suite green |
| PHP full | local `php artisan test`: 5 641 passed, 67 failed. **28** are container-environmental (`ext-bcmath` missing → 24+ fuel tests; 2 mail-view tests; same set as V2a). The other **39** were `StorefrontMediaApiTest`, caused by running the assembled project with V2a's tests but a pre-merge route table — re-synced after merging main and re-run: `StorefrontMedia* + StorefrontPresentation* + CommerceModuleBoundary` = **315 passed, 1 skipped, 0 failed**. PostgreSQL is verified by CI only. |
| Storefront | biome ✓ · `tsc` ✓ · `pnpm check:locales` ✓ · vitest (AnnouncementBar **32**, normaliser parity, layout) ✓ · `pnpm build` ✓ |
| Web | vitest full run (drift ratchet and boundary tests included) ✓ · `next build` (incl. TS) ✓ · panel/preview/issue tests (**23**) + `presentation-versions` 422 test |
| Playwright | `cust-hv-v3-announcements.spec.ts` — **12/12** (6 widths × AR/EN) |
| CI | see PR checks |

### Visual / responsive evidence
`docs/plans/store/cust-hv-v3/`: builder panel (AR 390, EN 1024), colour + contrast (EN 1280), window fields (AR 390), Canvas (AR 390 / EN 768 / AR 1280 / EN 1440); real storefront bar from the dev fixture — rotation (AR 390, EN 1280), ticker (EN 390), custom surface + sticky before/after scroll (EN 390, AR 768), 120-character message wrapping (AR 390).

---

## Invariants

| Invariant | Status |
|---|---|
| **Tenant Isolation** | No new route, table or query. Announcement data lives inside the existing tenant-scoped presentation document; dismissal key carries no tenant/user id and is origin-scoped (each storefront has its own origin). |
| **RBAC / auth** | Unchanged — the existing `commerce.manage` presentation endpoints; the 422 payload reveals only paths and stable codes of the caller's own document. |
| **Draft vs Published** | Draft preserves everything entered; only Publish/schedule/dispatch validate (AMEND-7). Published snapshots never gain a value the normaliser would drop. |
| **Revision / concurrency / stale responses** | Untouched — the validator runs inside the existing locked publish/schedule transactions *before* any write; the 422 changes no state and the builder's existing post-failure list refresh still runs. |
| **Media ownership** | N/A — no media in V3 (icons are a code-owned registry; no SVG upload). |
| **Commerce / accounting truth** | Untouched. No price, stock, offer or ledger code. No journal entries are produced by this slice. |
| **Backward compatibility** | Optional additive key; absent → no bar, no empty entity; documents without it normalise byte-identically; `PRESENTATION_CONFIG_VERSION` unchanged. Older storefront builds ignore the key. |
| **Accessibility** | Region label, prev/next/pause with names, ≥ 44 px targets, reduced-motion static, ≥ 4.5:1 enforced at Publish, `inert` while collapsed. |
| **No merchant CSS/JS/HTML** | Text is plain text; colours are validated hex; icons come from the registry; hrefs are internal or safe `https`. |

---

## Review / gate findings (resolved in-slice)

1. **Contract correction — near-black foreground.** V0 §4.5 sketched an automatic dark foreground of `#111827`. Measured: on mid-tone backgrounds it falls to ≈ 4.40:1, *below* the 4.5 the same section requires. The automatic foreground is therefore **white or pure `#000000`** (whichever is higher; worst case ≥ 4.58:1). This is a correction *toward* the invariant, not a change to it; V5/V6 own the general algorithm and should adopt it.
2. **Drift ratchet** (`design/__tests__/drift-ratchet`): the first panel used fixed-palette classes and a raw hex default → rewritten on semantic tokens; the custom-colour default is the store's own primary.
3. **Admin ↔ Storefront boundary** (`postures` test): the storefront CSS custom properties were named `--awj-ann-*`, inside the Admin namespace the storefront package must not own → renamed `--ann-*`.
4. **Codex review (3 × P2, all verified and fixed):** (a) the ticker marked its whole track `aria-hidden` while the first copy's links stayed focusable → only the loop duplicate is now `aria-hidden` + `inert`, the first copy is the real accessible list, and the off-screen text duplicate was removed; (b) the Canvas preview froze `now` until the document changed → one timer re-evaluates at the next window boundary (clamped to 24 h, as in the storefront); (c) the panel showed contrast for text only while the publish gate also checks `surface.link` → auto/custom link-colour control and a separate link/background readout. Tests added for each.
5. **GD/JPEG, Intervention and Biome** items from earlier in the slice (hook dependencies, control-character regex → `\p{Cc}`, rotation resume after Play via tri-state user choice, per-speed minimum ticker durations) are covered by tests.

## External evidence

V0 §12 and its evidence table record Salla SAL-PROMO / SAL-ADV (field set, multiple items, ticker, targeting; dismissal undocumented) and Daftra (no announcement bar found), re-fetched 2026-10-05 and unchanged. **Not re-fetched in this slice** — V3 implements the already-frozen AWJ decision (adopt the field set; add start date, rotation, dismissal with defined persistence, sticky; reject a separate title field and a per-version selector).

---

## Risks / deferred

- **Gradient and palette-role surfaces → V5.** V3 ships solid colour only (`surface.background.hex`); the schema leaves room (`ColorRef`) without a migration.
- **768–1023 px has no editing surface on `main`** (DEF-7 → V1B, co-designed with V5). The announcement panel is reachable at ≥ 1024 (sidebar) and < 768 (Design sheet select); the Canvas shows the bar at every width. Recorded in the e2e as an annotation, not worked around.
- **Dismissal flash:** a dismissed bar renders for the first frame before the stored dismissal is read (storage is client-only by contract). Acceptable for an opt-in feature; a pre-hydration inline script would fix it and was judged disproportionate.
- **Layout is dynamic by design** (`Date.now()` for `serverNow`, per-browser dismissal): the storefront layout already opts into dynamic rendering for presentation; no caching regression was introduced and none is claimed beyond the existing behaviour.
- **Icon registry** is the origin (12 keys); V7 extends it append-only. Directional icons are not used yet.
- **Operational:** none. No infrastructure, flag or migration.

## Next dependency-safe slice

**V2b** (derivative table + `transformKey`, orchestration proven against AWJ's real deployment — no scheduler, `QUEUE_CONNECTION=sync`) — depends on merged V2a. In parallel on the dependency graph: V4 (media picker UI) once V2b's contract is settled; V5 (+V1B) is unblocked by V3's panel/Canvas patterns.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
