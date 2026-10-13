# INT-UX-2 — Implementation Report

STATUS: PR open for review. Not merged. Not deployed.
DATE: 2026-10-13
TASK: Delivery Platform Catalog & Details inside the Integration Center (frontend only)
HORIZON: Integrations Center — Slice 3 (after INT-UX-1, PR #1387, merge `a88276175ec3cb5a21e28902ede97647ff59f579`)
SCOPE: INT-UX-2 only. INT-UX-3 was **not** started.

## Outcome

- `/integrations/delivery-platforms` — a catalog of the six platforms (HungerStation, Jahez, Mrsool, Keeta, Ninja, The Chefz). Each row shows four **independent** capability statuses.
- `/integrations/delivery-platforms/[platformKey]` — a per-platform detail page: the four-rung capability ladder, why the provider is not available, what works today, what a native integration requires, and the boundaries.
- The Integration Center delivery card now enters the catalog. The legacy `/delivery-platforms` screen and manual POS attribution are untouched and reachable from the detail page.
- **No Connect / Authorize / Reconnect / Sync control and no credential field exists anywhere, not even disabled.** This is pinned by structural source scans and by browser assertions.
- Readiness is read only from `GET /api/delivery-platforms/readiness`. Today: HungerStation and Keeta = OWNER_GATE (shown as "pending agreement"), Jahez/Mrsool/Ninja/The Chefz = BLOCKED (shown as "not available"); none READY; `connect_enabled = sync_enabled = false`.

## The four-rung ladder (independent facts, never merged into one badge)

| Rung | Meaning | Source | Today |
|---|---|---|---|
| A | Manual POS attribution | `GET /delivery-platforms` (tenant profile) | per tenant: set up / disabled / not set up |
| B | Native integration readiness | `GET /delivery-platforms/readiness` (`ux_state` + `connect_enabled`) | not available / pending agreement |
| C | Merchant account link | no data source exists | derived from B only: "not available before a native integration" |
| D | Order synchronization | no data source exists | derived from B only |

Fail-closed rules (`web/src/lib/integration-center.ts`):

- B is `available` only when `ux_state = READY_TO_CONNECT` **and** `connect_enabled = true`.
- Any contradiction (not-ready state with an enabled flag, sync enabled without connect, an unknown `ux_state`, a missing row) ⇒ **could not be read**, never guessed as ready and never as "not available".
- A failed or unrecognised payload ⇒ "could not be read", never "no integrations" and never success. A and B fail independently: a failed profiles call leaves native readiness intact and vice versa.
- C and D are never read from anywhere; they cannot become "available" while B is not.

The detail page states explicitly that the **AWJ signed event ingress** (an internal technical capability) is **not** a connected merchant account, and that its existence does not mean the platform is connected or that orders are being synchronized.

## Repository evidence

- Design: `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md` (§3 ladder, provider catalog, R-GATE-5/7), `INT-READY-1-IMPLEMENTATION-REPORT.md` (readiness endpoint and public/internal field split), `INT-UX-1-IMPLEMENTATION-REPORT.md`.
- Reused, unchanged: `DeliveryPlatformMark`, the central platform registry, `Badge` tones (neutral / muted / warning; no green), `Table` and `Skeleton` components, `hasPermission`, `currentUser`, `api()`.
- Endpoints used (exactly three, asserted by a structural test): `GET /applications/nav-state`, `GET /delivery-platforms`, `GET /delivery-platforms/readiness`.

## External research (mandatory visual research)

Done with a real Chromium (desktop and mobile); screenshots were viewed, not described from memory.

**External Evidence** — public pages only:

| Source | What it shows | Relevance |
|---|---|---|
| Salla App Store (`apps.salla.sa`, Arabic RTL) | 4-up card grid → single column on mobile; calm surfaces; tag chips | RTL composition and the desktop → mobile adaptation |
| Shopify App Store / Help Center | Disclosure that apps are third-party; "Built for Shopify" badges | Trust framing; partner-badge language |
| Daftra Help Center (`docs.daftra.com`) | RTL grouped topics with small icon tile + label | The functional reference product's RTL grouping |

**Limitation (stated, not hidden):** the logged-in admin screens of these products are behind authentication and were **not** inspected, so how competitors render per-provider connection states, disabled controls and permission-denied states in their admin consoles was **not observed**.

**AWJ Decision:** a dense accounting-style table on desktop (the table is the hero, per `DESIGN_SYSTEM.md`) that becomes stacked cards on mobile; four status columns rather than one merged badge; neutral/warning tones only; breadcrumb back to the Center; a detail page built as a ladder of four labelled rows each with its own reason sentence.

**Rejected / Not Adopted:** a single "Connected / Not connected" badge; any Connect, Authorize, Reconnect or Sync control (even disabled); ratings, prices, install CTAs, "official partner" or "Built for" badges; search/filters (six rows); green for any non-financial status; inferring C/D from A or from the signed ingress.

## What was built

- **Data hook** `use-delivery-integration-data.ts`: no request at all without `invoices.view`; `sales.pos` off in nav-state ⇒ stops after that one call; otherwise the two reads run with `Promise.allSettled` so each can fail on its own. Retry re-runs the same reads.
- **Catalog** (`delivery-platform-catalog.tsx`): table on `md+`, cards below; per-row link "View details"; read-failure alert with retry; boundary note that incoming orders never create invoices, payments, VAT or commission.
- **Detail** (`delivery-platform-detail.tsx`): ladder, signed-ingress note, "works today" links (shown only to users holding the corresponding permission), "requires" list, boundaries. A technical-evidence section (`technical`, `evidence_date`, `evidence_ref`) renders **only if the server sent those fields**, i.e. only for `delivery_connector.view` holders; the client does not decide that, it just does not invent them.
- **Unknown platform key**: validated against the registry before any request ⇒ "platform not found" with zero data requests.
- **States covered**: loading, success, API failure with retry (whole and partial), permission denied (zero requests), POS application off, unknown key, missing manual-attribution data.
- **Accessibility / RTL**: logical Tailwind classes only; `rtl:rotate-180` chevrons; `role="status"` + `aria-busy` while loading; `role="alert"` for read failure; breadcrumb landmark; visible focus ring; decorative icons `aria-hidden`.

## Changed files

| File | Change |
|---|---|
| `web/src/app/(app)/integrations/delivery-platforms/page.tsx` | New. Catalog route |
| `web/src/app/(app)/integrations/delivery-platforms/[platformKey]/page.tsx` | New. Detail route |
| `web/src/components/integrations/delivery-platform-catalog.tsx` | New |
| `web/src/components/integrations/delivery-platform-detail.tsx` | New |
| `web/src/components/integrations/delivery-ladder.tsx` | New |
| `web/src/components/integrations/integration-shell.tsx` | New. Breadcrumb + restricted notice |
| `web/src/components/integrations/use-delivery-integration-data.ts` | New. Gated reads + retry |
| `web/src/lib/integration-center.ts` | Ladder logic, readers, catalog href (delivery card now enters the catalog) |
| `web/src/messages/ar.json`, `en.json` | New `breadcrumb`, `backToCenter`, `catalog.*`, `ladder.*`, `detail.*` in the `integrationCenter` namespace |
| Tests (new) | `integration-center.ladder.test.ts`, `delivery-platform-catalog.test.tsx`, `delivery-platform-detail.test.tsx`, `no-connection-controls.test.ts`, two page tests, `e2e/int-ux-2-delivery-platform-catalog.spec.ts` |
| Tests (updated for the new href) | `integration-center.test.ts`, `integration-center-landing.test.tsx`, `integrations/page.test.tsx`, `e2e/int-ux-1-integration-center.spec.ts` |
| `docs/plans/pos/INT-UX-2-IMPLEMENTATION-REPORT.md` | This report |

The only non-INT-UX files touched are `web/src/lib/mock-data.ts` (demo fixtures, review fix) and its new test. No backend, API, database, migration, `Rbac`, readiness-registry, `DeliveryProviderReadinessGate`, accounting, POS or workflow change. The legacy `/delivery-platforms` screen is unmodified.

## Tests and exact results

| Run | Result |
|---|---|
| Ladder logic unit tests (`integration-center.ladder.test.ts`) | 20 passed (after the review fixes below) |
| Catalog + detail + structural component tests | 110 passed (3 files, both locales) |
| Page tests (catalog, detail, plus the updated Center page) | 27 passed (3 files) |
| `no-connection-controls.test.ts` (structural source scans) | 6 passed: no raw `<button>`/`<form>`/`<input>`; `<Button` only for retry; no write HTTP methods and no connector/credential routes; only the three allowed endpoints; allow-listed hrefs only |
| **Full web suite** (`npx vitest run`) | **535 files, 5788 tests passed**, exit 0 — run on code SHA `18121305`, before the review fix |
| Re-run after the review fixes (`src/lib`, `src/components/integrations`, `src/app/(app)/integrations`, plus the new demo test) | 677 tests passed in 88 files (includes the new demo test file, two new catalog page tests and a new detail-page test). The full suite and the Playwright spec were not re-run after these changes (browser fixtures always return all six readiness rows) |
| `npm run build` (Next.js 15.5.19, includes type check) | **Succeeded** (`BUILD_EXIT 0`); `/integrations/delivery-platforms` (3.93 kB) and `/integrations/delivery-platforms/[platformKey]` (4.09 kB) emitted |
| Playwright (real Chromium), `int-ux-2` + `int-ux-1` specs, desktop 1440 and mobile 390 | **75 passed, 1 skipped** (desktop-only check, skipped by design), exit 0 |

What the tests pin: the six platforms and their order; readiness mapping (OWNER_GATE → pending agreement, BLOCKED → not available, never "available" today); contradictions ⇒ "could not be read"; A and B failing independently; C/D never green while B is not available; the signed-ingress distinction in both locales; no connect/authorize/reconnect/sync/credential wording and no control element; denied ⇒ zero requests; app-off ⇒ exactly one request; unknown key ⇒ zero requests; internal evidence shown only when the server sent it (an accountant sees none); navigation Center → catalog → detail → breadcrumb back; AR/EN key parity.

Local PHP suite: **not re-run as evidence** — this change touches no PHP. The sandbox PHP suite has 154 environment failures that are identical on `main` (pre-existing, unrelated); they are not claimed as passing here.

## Visual verification (Horizon requirement)

Method: Next dev server, real Chromium via Playwright, all `/api/*` calls intercepted with controlled responses (no backend). 56 screenshots were captured and a representative set viewed, including catalog (AR/light desktop, AR/dark mobile), detail (EN/dark Keeta desktop, AR/light Jahez mobile), the read-failure state (EN/dark) and permission-denied (AR/light).

Matrix asserted automatically in the browser: desktop and mobile × Arabic RTL and English LTR × light and dark — `dir`/`lang`/`dark` class correct; table on desktop and cards on mobile (never both); no horizontal page scroll; no control element and no connection wording; WCAG contrast ≥ 4.5:1 computed from rendered colors for the key text and chips in light and dark; keyboard Tab order reaches the "View details" links with a visible focus indicator. States captured: loading, error, denied, POS app off, unknown key.

Observed in the screenshots: the four status columns read as independent; the warning-toned "Could not be read" is visually distinct from the neutral "Not available"; the read-failure alert keeps the table visible instead of replacing it; the mobile detail ladder stacks cleanly with the evidence block last; no red/green semantics are used.

Findings from the visual pass requiring a code change: none after the test fixes already committed. The red "3 Issues" pill is the Next.js dev-server overlay; the pre-existing next-intl `INVALID_KEY` console messages appear on every page (also on `/applications`) and this change adds none.

Not verified: behavior against the real backend and a real session (responses were intercepted); other browsers (Chromium only); a live screen-reader pass.

## Review findings (Codex, on `797aaf34`)

| Finding | Decision |
|---|---|
| P2 — a known-platform row with a missing/non-boolean `is_active` was dropped and shown as "Not set up" | **Valid; fixed in `2bde0d06`.** `readManualStatuses` now returns `null` (rung A "could not be read"). The earlier test that pinned the old behavior was replaced |
| P2 (second review, `ee466a38`) — malformed or missing readiness rows were skipped, giving a partial "successful" map with no banner/retry | **Valid; fixed.** `readReadinessRows` returns `null` when a known row is malformed or any of the six known rows is missing (unknown platforms are still ignored), so the read-failure banner and retry appear |
| P2 (third review, `625365b8`) — a duplicate known provider row silently overwrote the first, so row order could decide the displayed state | **Valid; fixed.** A repeated known `platform_key` makes `readReadinessRows` return `null` (banner + retry). Manual-attribution profiles keep their documented rule (several profiles per platform are legitimate; one active profile is enough) |
| P2 (fourth review, `0d7618e7`) — a contradictory or unknown-state readiness row stayed "could not be read" for its provider but showed no banner or retry | **Valid; fixed differently from the suggestion.** The hook raises the read-failure banner and retry whenever any known row resolves to "could not be read". The provider's own status stays unreadable and the other five keep their real status, instead of discarding the whole response |
| P2 (fourth review) — `{ data: [null] }` was accepted as an empty profile list ("Not set up" for all) | **Valid; fixed.** `readManualStatuses` and `readReadinessRows` use a strict row reader: any non-object entry makes the read unreadable. The older shared `rows()` used by the INT-UX-1 landing summary is deliberately unchanged |
| P2 (fifth review, `a7149bc2`) — the "requires" checklist said "Not yet available" even when rung B reads "Available" | **Valid; fixed.** The checklist follows rung B: "not yet available" while unavailable/pending, hidden once available (the page has no data for the three items, so it makes no claim), and "could not be read" when B is unreadable. Not reachable with today's data (no provider is ready), but correct for a future ready provider |
| P2 (sixth review, `c9544760`) — a manual-profile row with a missing or non-string `platform_key` was ignored, giving an empty "successful" list | **Valid; fixed in both strict readers.** A missing/non-string key makes the read unreadable (alert + retry); well-formed unknown string keys are still ignored |
| P2 (second review) — Demo login had no handlers for the two endpoints | **Valid; fixed.** `mock-data.ts` now serves `/delivery-platforms/readiness` (the six manifest rows, public fields only, none available, flags false) and `/delivery-platforms` (readable empty list). Pinned by `integration-center.demo.test.ts` |
| P2 — unknown platform key should return a real HTTP 404 | **Not changed; owner decision.** The page is a client component behind the authenticated shell, so crawlers/caches cannot reach it and the screen already makes zero data requests. A real 404 needs a server boundary, a segment `not-found.tsx` and rewrites of the unknown-key tests and browser spec. Offered as a small follow-up |

## CI

`web-ci.yml` (vitest + build) and `ci.yml` run on the PR. No CI result is claimed in this report; the observed result for the exact head is given in the hand-off message.

## Pre-merge review

- PRE_MERGE_REVIEW: **not stamped** — requires CI green on the exact Head SHA. Any later head change invalidates it.

## Merge

Not merged (stopped before merge by instruction). Not deployed.

## Self-review

### Implementer
- Logic is pure and separated from the hook and the presentational components, so every state is testable without a network.
- No endpoint, permission or payload shape was assumed beyond what INT-READY-1 documents; every payload is validated.

### Reviewer
- Table column order follows the central registry order (HungerStation, Jahez, Mrsool, Keeta, Ninja, The Chefz), not the order in which the platforms were listed in the task; this keeps one ordering shared with the readiness endpoint.
- Rungs C and D are deliberately derived, not read: there is no connection data model yet, and inventing one on the client would be a false claim.

### AWJ Guardian
| Risk | Result |
|---|---|
| A control that starts a connection appears for an unready provider | None exists; structural + browser assertions forbid it |
| Native readiness mixed with manual attribution | Separate rungs, separate sources, independent failure |
| Signed ingress read as a connected merchant account | Explicit note on the detail page; C stays blocked |
| Unreadable data shown as success or as "no integrations" | Always "could not be read" with retry |
| Internal evidence exposed to non-admin roles | Rendered only if the server sent it; accountant test asserts none |
| Data requested for a user who may not see it | Denied and unknown-key paths make zero requests |
| Tenant/branch isolation, accounting, POS touched | No |

## Accounting impact
None. No journal entry, invoice, payment, VAT, commission, settlement or stock path is read or written, so no journal-entry table applies.

## Tenant / branch isolation impact
Frontend only. Reads use existing authenticated, tenant-scoped endpoints.

## Security / authorization impact
No new permission. Client gating mirrors the server (`invoices.view`, `sales.pos`); the server remains the authority. No secret, token or credential is handled or rendered.

## Backward compatibility
Additive: two routes and message groups. `/delivery-platforms` and manual POS attribution are unchanged. The Center's delivery card now points to the catalog.

## API / DB / migration impact
None.

## Risks / remaining work

| Risk | Note |
|---|---|
| Verified against intercepted responses only | A pass with the real backend should accompany the first deploy smoke |
| Chromium only; no live screen-reader pass | Roles, names, focus order and contrast are asserted |
| Playwright spec is not run by `web-ci.yml` | It repeats the visual verification; CI type-checks it through `tsconfig.json` |
| Access logic duplicated between the Center landing page and the new hook | Deliberately not refactored (out of scope, INT-UX-1 left untouched) |
| Design doc drift | `DLV-INTEGRATIONS-UX-DESIGN-1.md` still shows the earlier delivery-card destination and subtitle wording |
| Pre-existing: 154 sandbox PHP failures, `tsc` errors in unrelated tests, next-intl `INVALID_KEY` logs | Unrelated and untouched |

## Git state

- Branch: `feat/int-ux-2-delivery-platform-catalog`
- Base SHA: `18ae2b3e074d883e976faf2b44935768cca35081` (`origin/main` at start; includes INT-UX-1 merge `a88276175ec3cb5a21e28902ede97647ff59f579`)
- Code SHA: `18121305c8378e377dd214a8f7f01a94699a58a2`
- Head SHA: the PR head (this file cannot embed its own commit hash; it follows the code SHA with a documentation-only change)
- PR: stated in the hand-off message

## Recommended next dependency-ready task

**INT-UX-3** per the Horizon plan, at the owner's instruction. Not started here. Independently, secret rotation/disable stays disabled until INT-AUDIT-1 (owner's standing rule).
