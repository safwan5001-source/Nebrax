# INT-UX-1 — Implementation Report

STATUS: PR open for review (#1387). Not merged. Not deployed.
DATE: 2026-10-13
TASK: Integration Center landing page under Settings (frontend only)
HORIZON: Integrations Center — Slice 2 (after INT-READY-1, PR #1381, merge `906e5afb76426a0bf128c03fe8891d384f31ef0d`)
SCOPE: INT-UX-1 only. INT-UX-2 was **not** started.

## Outcome

`Settings → Integration Center` (`/integrations`): one page with four cards in the approved order — delivery platforms, online stores, payment gateways, shipping companies. Only delivery platforms is enterable, and it enters the **existing** section `/delivery-platforms` (no duplicate route, no `/integrations/*`). The other three are **structurally inert**. There is no Connect, OAuth, sync or authorization anywhere, and the readiness of the six platforms is untouched.

## Repository evidence

- Design: `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md` §2, §5.1, §9.1, §9.3 and the final-review fixes in its handoff.
- Existing Settings hub pattern: `web/src/app/(app)/finance-settings/page.tsx` (card grid, link card vs inert card). Reused in spirit; its inert cards use `opacity-70`, which lowers text contrast, so this page uses a dashed border instead.
- Existing endpoints, unchanged: `GET /api/delivery-platforms` (ladder step A), `GET /api/delivery-platforms/readiness` (step B, INT-READY-1), `GET /api/applications/nav-state` (the same call the sidebar already makes).
- Sidebar mechanics: `web/src/components/layout/sidebar.tsx` (`GROUPS`, `NavItem.permission`), `nav-visibility.ts`, `permissions.ts`.
- Test and mock conventions: `web/src/test-utils/intl.tsx` (real AR/EN messages), existing Playwright config.

## External research (mandatory visual research)

Done on 2026-10-13 with a real Chromium (desktop 1440 and mobile 390), screenshots viewed, not described from memory.

**External Evidence** — what was actually seen:

| Source | What it shows | Relevance |
|---|---|---|
| Salla App Store (`apps.salla.sa`, Arabic RTL) | Marketplace storefront: hero, 4-up desktop card grid, single-column carousel on mobile; cards carry rating, price and "try free" CTAs; calm light surfaces, rounded cards, tag chips | RTL composition and the desktop 4-up → mobile single-column behavior |
| Shopify App Store (`apps.shopify.com`) | Dark promotional hero, "Built for Shopify" badges, ratings | Marketing pattern; badge language |
| Shopify Help — "Apps for your Shopify store" | Text states that most apps are built by third-party developers, not by Shopify | Trust/disclosure framing |
| Daftra Help Center (`docs.daftra.com`, Arabic RTL) | Support landing that groups topics under module headings with a small icon tile + label per entry; calm RTL layout | The functional reference product's RTL grouping style |

**Limitation (stated, not hidden):** these are public storefronts and help pages. The logged-in admin screens of these products are behind authentication and were **not** inspected, so in-product disabled / "coming soon" / permission-denied treatments of competitor admin hubs were not observed.

**AWJ Decision:** keep AWJ's own settings-hub pattern (`finance-settings`), a 2×2 grid on desktop and one column on mobile, calm neutral surfaces, icon + title + one line per card, dashed border for inert cards, one identity color. A short disclosure line that no integrations exist in the future categories (the spirit of the Shopify help note, applied to AWJ's own state).

**Rejected / Not Adopted:** ratings, prices, "try free"/install CTAs, promotional heroes, "Built for X" or partner badges (would imply an official partnership, design R-COPY-3), carousels, search and filters (six platforms and four categories do not need them).

## Design reconciliation (approved image vs. specification)

| Item in the approved image | Decision | Why |
|---|---|---|
| Green badge «ضمن التصميم» on the delivery card | Neutral badge (`bg-primary-soft` + check icon), text «الإسناد اليدوي متاح» / "Manual attribution available" | `DESIGN_SYSTEM.md` reserves semantic green for financial meaning; «ضمن التصميم» was a mock-up annotation, not product copy; the true state is manual attribution, not native integration |
| «القسم الأول» under the title | Description «الإسناد اليدوي في نقطة البيع وصندوق التوصيل.» | A "first section" label reads as a launch sequence for integrations that are not ready |
| Subtitle «إدارة الخدمات والتطبيقات المرتبطة بأَوْج» | «مكان واحد لمتابعة منصات التوصيل والخدمات الخارجية مع أَوْج.» | "Manage linked services" implies working integrations. (The design document's own proposed subtitle also said "Connect AWJ…"; the shipped copy is deliberately more conservative — see Backlog.) |
| «توسع مستقبلي» on three cards | Kept, per the owner's instruction, plus a page note «لا تتوفر حالياً أي تكاملات مع منصات خارجية في فئات التوسع المستقبلي.» | The wording has no date and no launch promise; the note states the actual state |
| Card order and 2×2 composition | Kept. DOM order = delivery, online stores, payments, shipping; in RTL the grid fills right-to-left, reproducing the image | — |
| Header icon at the end side, title at the start side | Kept (logical properties) | — |
| Section caption «التصور المعتمد» | Not part of the product page | It is a presentation frame of the mock-up |

## What was built

- **Entry:** `{ href: '/integrations', icon: Plug, key: 'integrations', permission: 'invoices.view' }` in the sidebar `settings` group between "Application Management" and "Account settings". Label «مركز التكاملات» / "Integration Center". No `appKey` (the Center will span future categories with different capabilities); the POS-application state is shown inside the page.
- **Access:** `invoices.view` (mirrors `/delivery-platforms`; existing permission, **no new permission**) and the `sales.pos` application. Without the permission the page makes **no API request at all** and shows an inert denial card. If `nav-state` says `sales.pos` is off, the page stops after that one call and shows an inert card (with a "Manage applications" link only for users holding `apps.view`). A failed `nav-state` call hides nothing (the server still guards), like the sidebar.
- **Summary lines on the delivery card:** "{n} of 6 platforms set up for POS attribution" (step A) and "Native integrations: none available yet" or "{k} available" (step B, from `ux_state` only — never the owner/admin-only evidence fields). Each line is omitted when its read fails or returns an unrecognized shape; an unreadable payload is never turned into "none available". Two failed reads show an alert with retry; the card stays enterable.
- **Inert cards:** plain `div` elements with no link, button, `tabindex`, `role` or handler; a dashed border instead of reduced opacity so text keeps its contrast.
- **Accessibility:** one landmark section labelled by the page title; the delivery link has `aria-labelledby` (title) and `aria-describedby` (description, badge, summary); decorative icons are `aria-hidden`; loading uses `role="status"` + `aria-busy`; the error uses `role="alert"`; the chevron mirrors with `rtl:rotate-180`; only logical Tailwind classes.

## Changed files

| File | Change |
|---|---|
| `web/src/app/(app)/integrations/page.tsx` | New. Container: permission/application gating, two reads, retry |
| `web/src/components/integrations/integration-center-landing.tsx` | New. Presentational page |
| `web/src/lib/integration-center.ts` | New. Pure logic: categories, payload readers |
| `web/src/components/layout/sidebar.tsx` | +1 import, +1 nav item |
| `web/src/messages/ar.json`, `en.json` | `nav.integrations` and the new `integrationCenter` namespace (name chosen to avoid the Document Center `platformIntegrations` namespace) |
| `web/src/lib/integration-center.test.ts` | New. 11 tests |
| `web/src/components/integrations/integration-center-landing.test.tsx` | New. 36 tests (both locales) |
| `web/src/app/(app)/integrations/page.test.tsx` | New. 7 tests |
| `web/src/components/layout/__tests__/integrations-nav.test.ts` | New. 4 tests |
| `web/e2e/int-ux-1-integration-center.spec.ts` | New. Real-browser verification (35 runs + 1 intentional skip) |
| `docs/plans/pos/INT-UX-1-IMPLEMENTATION-REPORT.md` | This report |

No backend, API, database, permission (`Rbac`), financial, workflow or provider-readiness change. No `mock-data.ts` change.

## Tests and exact results

Local, Node + the repository's own tooling.

| Run | Result |
|---|---|
| New vitest files + `src/components/layout` (11 files) | **111 passed** |
| New tests alone | 58 tests (11 + 36 + 7 + 4) |
| Full web suite (`npm run test`) | VITEST_RESULT |
| `npm run build` (Next.js 15.5.19, includes type check) | **Succeeded** (`BUILD_EXIT 0`); `/integrations` is emitted (5.78 kB route, 185 kB first load) |
| `tsc --noEmit` over the repository | Pre-existing errors in unrelated test/e2e files; **none** in any file of this change (the only line containing "integrations" is `src/app/platform/(console)/integrations/gemini-card.test.tsx`, which is unrelated and untouched) |
| Playwright (real Chromium), `e2e/int-ux-1-integration-center.spec.ts`, projects desktop 1440 and mobile 390 | **35 passed, 1 skipped** (the sidebar-entry check is desktop-only by design) |

What the unit/component tests pin: card order; delivery is the only link and points to `/delivery-platforms`; the three future cards are `div`s with no focusable or interactive descendant; one tab stop; no connect/authorize/sync wording and no launch/partner claim in either language; neutral (non-green) badge; logical direction only; step A/B summary honesty (zero vs null vs available); loading, denied, app-off, error and retry states; denied makes **zero** API calls and app-off makes exactly one; no write request is ever issued; AR/EN key parity; the nav entry is declared once, in the settings group, with `invoices.view` and no `appKey`, visible to owner/admin/accountant/staff and hidden from self-service and unknown users.

## Visual verification (Horizon requirement)

Method: Next dev server on `:3001`, real Chromium via Playwright, all `/api/*` calls intercepted with controlled responses (no backend). Screenshots were taken for every state and viewed.

Matrix verified: desktop 1440 and mobile 390 × Arabic RTL and English LTR × light and dark, plus the states loading, permission denied, application off and summary error (Arabic/light and English/dark, both viewports) — 24 screenshots. Automated assertions in the real browser, per combination:

- `<html dir>`, `lang` and the `dark` class match the locale and theme.
- Composition: 2×2 grid on desktop with the delivery card on the **right** in RTL and **left** in LTR; one column on mobile with the order delivery → stores → payments → shipping.
- No horizontal page scroll.
- Exactly one focusable element in the page content; the three inert cards cannot be focused and a click does nothing (URL unchanged); Tab from the delivery card leaves the page content.
- No connect/authorize/sync/launch wording and no `positive` (green) class.
- WCAG contrast ≥ 4.5:1 computed from the actual rendered colors for the title, card title, description, active badge, summary lines, inert-card text and the page note — in light **and** dark.
- Clicking the delivery card navigates to `/delivery-platforms`.

What the screenshots show (viewed by the author): the arrangement matches the approved image in both directions; the active badge is a quiet blue with a check mark; inert cards read as quieter through the dashed border while their text stays legible; the chevron points toward the reading direction in both locales; mobile stacks cleanly with the note below the cards.

Findings from the visual pass: none requiring a code change. Notes: (1) the red "3 Issues" pill in every screenshot is the Next.js **dev-server** indicator; I captured browser console output on `/integrations` and on the existing `/applications` page and both log the identical pre-existing next-intl `INVALID_KEY` messages (dotted keys in `appBuilder`/`developer` namespaces), so this page adds none; (2) the pill overlaps the bottom-start corner of the screenshots only because it is a dev overlay.

Not verified: behavior against the real backend and a real session (responses were intercepted); other browsers (Chromium only); a screen-reader pass (assertions cover roles, names and focus order, not a live reader).

## Build / lint / typecheck

`npm run build` passed. There is no separate lint step configured in `web-ci.yml` (CI runs vitest and `npm run build`).

## CI

CI_SECTION

## Pre-merge review

- PRE_MERGE_REVIEW: PRE_MERGE_STATUS
- Reviewed Head SHA: HEAD_SHA_REVIEWED

## Merge

Not merged (stopped before merge by instruction). Merge SHA: none. Not deployed.

## Self-review

### Implementer
- The page and logic are separated (container / presentational / pure), so every state is testable without the network.
- No new endpoint, permission or API shape was assumed: both payloads are validated and degrade to "omit the line".
- The sidebar change is one import and one item; nothing else in that file moved.

### Reviewer
- The nav item carries `permission: 'invoices.view'` while design §9.1 said "no group-level permission". This is an **item-level use of an existing permission**, not a new permission, and it closes the open P3 from the design's final review (self-service users no longer see an entry that only leads to a denial page). It is documented in the sidebar comment and pinned by a test.
- «توسع مستقبلي» is kept at the owner's direction although design R-COPY-3 discourages "coming soon" wording; it carries no date or promise, and the page note states the real state.
- A custom role granted `company.manage` but not `invoices.view` will not see the entry; that matches the access rule of the only section it leads to.

### AWJ Guardian
| Risk | Result |
|---|---|
| A control that starts a connection appears for an unready provider | None exists in this slice; test and browser assertions forbid connection verbs |
| Future categories imply a working integration | Inert `div`s, "Future expansion" wording, and an explicit "no integrations available" note |
| Step B misread as ready | Counted only from `ux_state === 'READY_TO_CONNECT'`; unreadable ⇒ line omitted, never "none" |
| Internal evidence exposed to non-admin roles | The page reads only the public fields; `technical`/`evidence_*` are never read |
| Data requested for a user who may not see it | Denied users trigger no request (test: zero API calls) |
| Tenant/branch isolation | No tenant or branch data is read; the two reads are existing, server-scoped endpoints |
| Financial or POS behavior touched | None; manual attribution and the existing `/delivery-platforms` screen are only linked |
| Green used for a non-financial status | Neutral badge; no `positive` class (asserted) |

## Accounting impact

None. No journal entry, invoice, payment, VAT, commission, settlement or stock path is read or written, so no journal-entry table applies.

## Tenant / branch isolation impact

Frontend only. Reads go through the existing authenticated, tenant-scoped endpoints; the page adds no branch logic.

## Security / authorization impact

No new permission. Client-side gating mirrors the server (`invoices.view`, `sales.pos`); the server remains the authority. No secret, token or credential is handled. Provider-returned text is not rendered anywhere in this slice.

## Backward compatibility

Additive: one new route, one new sidebar entry, two new message groups. Existing screens, the sidebar's other entries, APIs, and the manual POS attribution flow are unchanged.

## API / DB / migration impact

None.

## Risks / remaining work

| Risk | Note |
|---|---|
| Verified against intercepted responses only | A pass with the real backend should accompany INT-UX-2 or the first deploy smoke |
| Chromium only | Safari/Firefox rendering not checked |
| No live screen-reader pass | Roles, names, focus order and contrast are asserted; a manual pass is recommended before release |
| Playwright spec is not run by `web-ci.yml` | It documents and repeats the visual verification; the CI build does type-check it because `tsconfig.json` includes `e2e/` |
| Pre-existing `tsc` errors elsewhere | Unrelated to this change; not touched |

## Discovered backlog

- The design document §9.3 still lists the earlier subtitle ("Connect AWJ…") and `planned.note`; reconcile it with the shipped, more conservative copy when INT-UX-2 next edits that document.
- The pre-existing next-intl `INVALID_KEY` console errors (dotted keys under `appBuilder.builder.visibility.signalOption` and `developer.events`) are unrelated to this work.
- `mock-data.ts` has no demo responses for `/delivery-platforms` or `/delivery-platforms/readiness`; in demo mode the summary lines degrade (omitted) rather than fail.

## Git state

- Branch: `feat/int-ux-1-integration-center-landing`
- PR: #1387 — https://github.com/safwan5001-source/Nebrax/pull/1387
- Base SHA: `906e5afb76426a0bf128c03fe8891d384f31ef0d` (`origin/main` at start)
- Code SHA (feature commit): `f17d5545632d84058c061f623e60cd6087c63dd1`
- Head SHA: HEAD_SHA_FINAL

## Recommended next dependency-ready task

**INT-UX-2** — delivery platforms catalog and provider Overview (`/integrations/delivery-platforms`, `/integrations/delivery-platforms/[platformKey]`): the four-row capability ladder, the per-platform reasons, "what works today", and the permanent invariant test that no Connect/Authorize/Link control exists for any provider (R-GATE-5, R-GATE-7). It depends on INT-UX-1 (this PR) and INT-READY-1 (merged). At that point the delivery card's destination can move from `/delivery-platforms` to the new catalog; until then it must keep entering the existing section.

**Merge ≠ Deploy.** No production release is authorized.
