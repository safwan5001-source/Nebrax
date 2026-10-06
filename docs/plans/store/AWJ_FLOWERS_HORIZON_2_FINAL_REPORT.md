# AWJ Flowers & Gifts — Horizon 2 Final Report

**Date:** 2026-10-06
**Execution authority:** `AWJ_FLOWERS_HORIZON_2_MERCHANT_ADMIN_SURFACES.md` · progress ledger: `AWJ_FLOWERS_HORIZON_2_PROGRESS.md` · cross-slice decisions: `ADR-27-FLOWERS-MERCHANT-ADMIN-SURFACES.md` · predecessor: `AWJ_FLOWERS_HORIZON_1_FINAL_REPORT.md`
**Execution base (H2-1):** `main` @ `afe223cb654154fa55234ff2e360233bbc933ec3`
**Final Horizon 2 merge (H2-15):** `37a0a53316b5abdcef0ac70a7639955fe663d37f` (this report is slice H2-16, merged after it)

---

## 1. Executive summary

Horizon 1 shipped the Flowers & Gifts capabilities end to end, but a merchant could only switch most of them on through the API. Horizon 2 closes that adoption gap: **every in-scope capability now has a real AWJ dashboard surface** — gift policy, delivery schedule, delivery windows and capacity, blocked dates, fulfilment warehouse, and, per product, preparation time, personalization, add-ons and structured content — plus a setup centre and a guided onboarding that tell the merchant what is missing and take them to the screen that fixes it.

- **16 slices, 15 feature/test PRs merged, one report PR (this one).** H2-1…H2-15 are merged on `main` (PRs #1237, #1238, #1239, #1240, #1241, #1243, #1246, #1248, #1249, #1250, #1251, #1253, #1254, #1257, #1258), strictly one dependent PR at a time.
- **Almost entirely frontend.** The server stayed the single authority: no price, promise, capacity or availability is computed on the client, no accounting / stock / invoice / ZATCA path was touched, and every new write goes through an existing, permission-scoped, tenant-scoped endpoint. The backend changes are small and additive (§4).
- **Quality gates were real.** Codex review ran on six PRs and raised **32 findings, every one verified valid and fixed with a test** (one was a P1 purchasability bug, now enforced on the server too); CI (sqlite + PostgreSQL + web build, on both the PR and push events) was green on every merged head; a unified RBAC / tenant-isolation matrix and a client-to-real-server journey contract now guard the whole surface against drift.
- **No financial, accounting, VAT, ZATCA, inventory-valuation or payment code changed.** No migration was added. No Horizon-2 deferred domain was implemented.
- **Deployment:** manual deploy **not performed**; automatic CI/CD **not observable from GitHub**; production verification **not performed** (§17).

---

## 2. Slice register

All slices were squash-merged on a fully green head. "Head" is the final PR head (earlier heads are in the ledger). Base for each slice is the previous slice's merge.

| Slice | Scope | Branch | PR | Base SHA | Head SHA | Merge SHA |
|---|---|---|---|---|---|---|
| H2-1 | Gift Policy Admin | `flowers/h2-1-gift-policy-admin` | #1237 | `afe223cb654154fa55234ff2e360233bbc933ec3` | `bda518e53185f37ffa2c00196644ad004cb08769` | `cfc16aa93527c3e2f11aab418355354499ef27b3` |
| H2-2 | Delivery Schedule Admin | `flowers/h2-2-delivery-schedule-admin` | #1238 | `cfc16aa93527c3e2f11aab418355354499ef27b3` | `830b77db3fa0687cd91a194fed3deb5e768607e4` | `37d462f54e091a4ba630b41ec3210b90e00e3b21` |
| H2-3 | Delivery Windows & Capacity | `flowers/h2-3-delivery-windows` | #1239 | `37d462f54e091a4ba630b41ec3210b90e00e3b21` | `3218ebfc59f1f1c44baa8aefc7eace574a5d978e` | `5ff339b7581be46891766d7361edb6446f8d1057` |
| H2-4 | Blocked Dates & Exceptions | `flowers/h2-4-blocked-dates` | #1240 | `5ff339b7581be46891766d7361edb6446f8d1057` | `3f9f5381e941dc4af6a24a6cd605f3ecbe6b2873` | `323c5f58d6e7ad9cc9d2591d9b049f07936ee873` |
| H2-5 | Fulfilment Warehouse Setup | `flowers/h2-5-fulfillment-warehouse` | #1241 | `323c5f58d6e7ad9cc9d2591d9b049f07936ee873` | `ba7bfb183e0a331859d75879f34cbb4d8c9d5999` | `a53bcd0ab3a5b6e9e9bffcc7e6be588ddbf64c7a` |
| H2-6 | Product Preparation Time | `flowers/h2-6-product-preparation` | #1243 | `a53bcd0ab3a5b6e9e9bffcc7e6be588ddbf64c7a` | `8d9a15c14cc458178176dc85ba43611c68976de7` | `a10359d5f9de12a972c728f5dcc71397e4e45319` |
| H2-7 | Product Personalization Admin | `flowers/h2-7-product-personalization` | #1246 | `a10359d5f9de12a972c728f5dcc71397e4e45319` | `135e73723fd8a0e8f32e0af06af3df4df71d4802` | `f294c2d11da7b4f15a04895c3801684dd776580e` |
| H2-8 | Product Add-ons Admin | `flowers/h2-8-product-addons` | #1248 | `f294c2d11da7b4f15a04895c3801684dd776580e` | `497d4f49d19d378c74ecc561721472272f5c6845` | `bb03b6974023f71568c39070721863430fd64574` |
| H2-9 | Structured Product Content Admin | `flowers/h2-9-product-content` | #1249 | `bb03b6974023f71568c39070721863430fd64574` | `4314efde5ccde140411832a181f47893bbaaf743` | `f8ec4757f932da6ff350a24fbdf5998f2ca82f64` |
| H2-10 | Unified Product Gifting Workspace | `flowers/h2-10-product-gifting-workspace` | #1250 | `f8ec4757f932da6ff350a24fbdf5998f2ca82f64` | `b6f1c9be70348f9bfb63d7f6e1b091ba71754de9` | `4a22e811f6ff723d6b95a5c396ca80e6ca8e0903` |
| H2-11 | Vertical Setup Center V2 | `flowers/h2-11-setup-center` | #1251 | `4a22e811f6ff723d6b95a5c396ca80e6ca8e0903` | `5758474c69fd8811fdd50dfc1edbc1c44ac4a751` | `df85e5a75af37bce171388b2f554b9cf670630fd` |
| H2-12 | Merchant Onboarding Flow | `flowers/h2-12-merchant-onboarding` | #1253 | `df85e5a75af37bce171388b2f554b9cf670630fd` | `9977090f87233f197ba6040a1e3e29ad0c655133` | `95bc96d9837537b74b0354195942f0afeed9cb2b` |
| H2-13 | Permissions / RBAC / Tenant Isolation Pass | `flowers/h2-13-access-isolation-pass` | #1254 | `95bc96d9837537b74b0354195942f0afeed9cb2b` | `c33c0a4af1f97edd2ed98391d4f68009a4106a10` | `ed5ce4e7369d48b2b4b62264b856f3ff212f7d06` |
| H2-14 | Admin UX / RTL / Mobile Polish | `flowers/h2-14-admin-ux-polish` | #1257 | `ed5ce4e7369d48b2b4b62264b856f3ff212f7d06` | `6b06367ab782111079165d69ae2012590546e69a` | `db8df63fd474dda91ae6718cc32929c1be1c9e65` |
| H2-15 | Real Merchant Journey Contract | `flowers/h2-15-merchant-journey-contract` | #1258 | `db8df63fd474dda91ae6718cc32929c1be1c9e65` | `40f0170ac1e8408d0457b0c33e761b3855800e1e` | `37a0a53316b5abdcef0ac70a7639955fe663d37f` |
| H2-16 | Cross-Horizon Integration & Final Report | `flowers/h2-16-final-report` | (this PR) | `37a0a53316b5abdcef0ac70a7639955fe663d37f` | (this PR) | (recorded in the PR) |

Merge size (squash diffs, files / +lines / −lines): H2-1 23/1327/4 · H2-2 22/1763/33 · H2-3 20/1712/21 · H2-4 12/874/13 · H2-5 14/870/22 · H2-6 16/828/7 · H2-7 14/1627/21 · H2-8 11/1193/12 · H2-9 11/1047/11 · H2-10 13/305/31 · H2-11 13/1023/24 · H2-12 9/555/13 · H2-13 2/251/5 · H2-14 13/415/22 · H2-15 18/1032/9.

---

## 3. What the merchant can do now

| Surface | Where | What it does | Server contract (unchanged unless §4) |
|---|---|---|---|
| Gift policy | `/commerce/gifting` | Enable gifting, message length, hide-sender, recipient-phone requirement | `GET/PUT storefronts/{id}/gift-settings` |
| Delivery rules | `/commerce/delivery?tab=rules` | Scheduling on/off, required, timezone (full PHP zone list), lead time, cut-off, horizon | `…/delivery-schedule`, `…/settings` |
| Windows & capacity | `…?tab=windows` | Delivery/pickup windows, weekdays, capacity, shipping zone, active | `…/delivery-schedule/slots` |
| Blocked dates | `…?tab=blocked` | Per-date exceptions per method with a reason | `…/delivery-schedule/blocked-dates` |
| Fulfilment warehouse | `…?tab=fulfilment` | The warehouse same-day availability is computed from | `…/fulfillment` (new thin route, §4) |
| Product preparation time | Product → Gifting → Preparation | Product-specific lead time | `products/{id}/preparation` |
| Personalization | Product → Gifting → Personalization | Text / textarea / choice inputs, options, required, limits | `products/{id}/personalization` |
| Add-ons | Product → Gifting → Add-ons | Related products (+ variant), max quantity, active | `products/{id}/addons` |
| Structured content | Product → Gifting → Content | Care, composition, allergens, storage… (10 closed types, plain text) | `products/{id}/content` |
| Setup centre | `/commerce` (Flowers store) | Real per-capability status, what is missing, one-click route to the fix | `vertical-setup` (+ starters preview/apply) |
| Onboarding | `/commerce/onboarding` | Guided, resumable walk through the same capabilities | derived; position in URL |

Information architecture: the four product capabilities live in **one** Gifting workspace on the product page (sub-tabs with server-reported counts, one Save bar per section, deep links via `?tab=gifting&section=…`); the four store capabilities live under Commerce → Gifting and Delivery. The setup centre and onboarding are the connective tissue.

---

## 4. Backend changes (all additive, none breaking)

Horizon 2 is a frontend Horizon; the server changes are the minimum needed for correct concurrent editing and one safety invariant.

1. **Optimistic concurrency on full-set replace endpoints** (slots, blocked dates, personalization, add-ons, content). Each document now carries a `revision` (sha1 of the stored content, computed from the same snapshot as the returned data); `PUT` accepts an **optional** `expected_revision`, compared **inside the DB lock** — a mismatch returns **409** and writes nothing (`StaleRevisionException`). Omitting it keeps the previous behaviour (backward compatible). This prevents two merchants silently overwriting each other, which a full-set replace otherwise would.
2. **New thin route** `GET|PUT storefronts/{id}/fulfillment` over the existing `FulfillmentPolicyService` (no new table, no new authority): assigns one active warehouse, replacing the single row; foreign / unknown / disallowed warehouse → one non-revealing 422; no journal entry, no stock movement. Added to the `CommerceModuleBoundaryTest` route allowlist.
3. **Per-window weekday uniqueness** in the slots validator (replaces a nested `distinct` rule that wrongly rejected two windows sharing a weekday — found only against the real API, with a regression test).
4. **Safety invariant (found by Codex, P1):** an *active + required* personalization choice with **no active option** is rejected (422, nothing written) because no cart request could satisfy it and the product would become unpurchasable. Enforced on the server (`ProductPersonalizationService::assertOptions`) and mirrored in the client.
5. Test-only: ZATCA certificate-material test pads EC coordinates to 32 bytes (a pre-existing random-key flake — leading zero — that failed sqlite twice; PR comment recorded).

No migrations. No change to `LedgerService`, `InvoiceService`, `PaymentService`, `InventoryService`, ZATCA or VAT code.

---

## 5. Cross-slice engineering decisions (ADR-27)

- **Server authority.** The client never computes a price, a delivery promise, a capacity or an availability. Inputs are validated for usability, not re-implemented; the server is the judge and its errors are shown field-level.
- **Policy is configured, not forced.** Every behaviour with more than one reasonable business answer is a merchant setting with a safe default (gift on/off, scheduling required or not, lead time, etc.).
- **Fail closed.** Unreadable or unrecognised server rows fail the load (they are never silently dropped, because a whole-set save would delete them server-side); a failed pre-read aborts the save; a failed refresh after a 409 is reported, not claimed.
- **Unsaved-draft protection** (`unsaved-registry` + `useUnsavedGuard`): `beforeunload`, store switch, in-app link clicks (capture-phase guard), delivery-tab switch and the outer product-tab switch all confirm before discarding a draft.
- **Shared kit** (`flowers-admin/`): `admin-http` (typed results), `messages` (AR/EN parity), `StoreGate`, `SettingsList`, `ConfirmDialog`, `FlowersDialog` (focus entry/trap/restore), timezone list, setup centre and onboarding.
- **No stored completion state.** Setup/onboarding status is always derived from the real configuration; the only persisted position is the URL.

---

## 6. UX/UI decisions and visual QA

Design rules followed (current AWJ design system, semantic tokens, shared primitives; no gradients/glass/glow, no decorative badges, Lucide icons): clarity > density > speed > trust > consistency. Every screen has loading, empty, populated, saving, success, validation, server-error and read-only/disabled states; state is never conveyed by colour alone (icon + sr-only text).

**Evidence (Playwright, desktop project; each test sets its own viewport; screenshots are written per run):**

| Check | Coverage |
|---|---|
| Arabic RTL + English LTR | every screen, both locales |
| Mobile 390 / 430, tablet 1024, desktop 1440 | per-slice specs run the matrix; H2-14 audit runs AR-390 light, EN-1440 light, AR-1024 dark across all 11 screens |
| No horizontal overflow | `assertNoOverflow` on every screen/state |
| Dark mode | per-slice dark case + H2-14 AR-1024 dark across all screens |
| Dialogs | focus enters, 40 consecutive Tabs never leave, Escape closes, focus returns to the exact opener (slot + personalization dialogs, AR-390 and EN-1440) |
| Automated audit (`auditPage`) | on every audited screen/dialog: accessible names, valid `aria-*` refs, no duplicate ids, heading order, ≥ 24×24 targets — **empty findings** |

**H2-16 re-run on the final `main` (all Horizon 2 specs together): 186 / 186 passed** (H2-1/2/3: 42 · H2-4…H2-8: 59 · H2-9/10/11/12/14: 85).

---

## 7. Accessibility

Labelled controls and `aria-invalid`/described errors on every field; tablist/tabpanel semantics (store tabs, product sub-tabs, delivery tabs); `aria-current="step"` in onboarding; progressbars with accessible names; accessible reorder (named move up/down buttons); localized dialog close labels; focus trap/restore; 24 px minimum targets (WCAG 2.2 2.5.8); visible focus rings; state never by colour alone. Shared-component gaps the audit found and fixed in H2-14: topbar search had no accessible name; the Gregorian date input pointed `aria-controls` at a missing id.

---

## 8. Tenant Isolation, RBAC and security review

- **Tenant isolation is by construction** (`TenantContext` / `TenantScope`); no tenant or channel id is ever taken from the client. A foreign store or product answers a **non-revealing 404** on every method; a rejected save writes nothing.
- **Unified access matrix** (`FlowersMerchantAdminAccessMatrixTest`, H2-13): store routes need `commerce.manage` for read **and** write (accountant / staff / self-service → 403, guest → 401); product routes split `products.view` (read) from `products.manage` (write) (staff reads but cannot write; self-service and guests denied); cross-tenant add-on references are rejected (422) and write nothing; a **route-inventory guard** fails the build if a Flowers admin route is added or removed without updating the matrix.
- **UI hiding is not the guard.** The Gifting tab and the setup centre are hidden without `commerce.manage` and issue **no request**, but the routes enforce permission independently.
- **Plain text only** for merchant content (no HTML/rich text); Unicode-aware length limits match the server; no file upload.
- **Idempotent/optimistic writes** (revisions) prevent lost updates between merchants.
- No secrets, credentials or tokens introduced; no external service calls.

---

## 9. Backward compatibility

- All server changes are additive; `expected_revision` is optional; responses gain `revision` fields additively.
- **Non-Flowers tenants/stores are unchanged:** the product-page Gifting tab appears only for a tenant with a Flowers & Gifts store **and** a user holding `commerce.manage` (otherwise no tab and zero requests — covered by the capability-hook and H2-6 tests); the `/commerce` overview and `/commerce/onboarding` fall back to the unchanged overview / an explicit empty state for other stores; general retail, POS, invoicing, accounting and ZATCA flows were not touched.
- The shared `Dialog` default label/behaviour is unchanged for every other module (`closeLabel` is opt-in); the product page's outer-tab guard only prompts when a Flowers draft exists (the registry is empty otherwise).
- The one behavioural tightening — rejecting an active + required choice with no active option — applies to **new writes only** (existing stored data is not rewritten) and protects purchasability; see risks.

---

## 9b. Cross-Horizon integration check (H2-16)

Run on the final `main` (`37a0a53`):

| Task | Result |
|---|---|
| Full merchant journey (client request builders → real API → client parsers) | `admin-journey-contract` 15 web tests + `FlowersMerchantAdminJourneyTest` (73 assertions): the client's own requests (incl. live `expected_revision`) are replayed unchanged on the real API, responses compared strictly, post-save revision identity asserted, stale revision → 409 |
| RBAC / tenant isolation | `FlowersMerchantAdminAccessMatrixTest` 6 tests / 108 assertions |
| Backend suites around the surface | filter `Flowers|CommerceProduct|CommerceDelivery|CommerceFulfillment|CommerceGift|CommerceModuleBoundary|CommerceVerticalSetup|Personalization|Addon`: **214 passed, 5 skipped (1918 assertions)** locally; CI is the full-suite gate |
| Full web unit suite | **413 files / 3407 tests passed** |
| RTL/LTR/mobile/desktop | 186 / 186 Playwright (§6) |
| Inconsistencies found | none requiring a code change; (the only environment issue — a stale local dev server holding port 3001 — was local, not a product issue) |

---

## 10. Tests (exact)

| Layer | Result |
|---|---|
| Web unit/component (vitest), final `main` | 413 files, **3407 tests**, 0 failed |
| Playwright Flowers Horizon 2 specs, final `main` | **186 passed**, 0 failed |
| PHP, Horizon-2-relevant filter, local | 214 passed, 5 skipped (1918 assertions) |
| PHP journey contract | 1 test / 73 assertions |
| PHP access matrix + route-inventory guard | 6 tests / 108 assertions |
| PHP full suite | **CI only** (sqlite + PostgreSQL) — green on every merged head |

Per-slice focused tests are listed in the ledger (client mapping tests, section/component tests, backend feature tests incl. stale-revision 409 cases, Playwright specs).

---

## 11. CI and review per PR

Every PR merged only on a head where **all** checks were green on the `pull_request` run (`web build`, `php artisan test` on sqlite, `php artisan test` on PostgreSQL), with the duplicate `push` run also green or finished. After each merge the push run on `main` was observed: **`ci.yml` completed `success` for 14 of 15 Horizon 2 merge commits at the time of writing; the run for the H2-15 merge commit (`37a0a53`) was still in progress** (its PR-event run had passed all checks).

CI notes:
- `CommerceModuleBoundaryTest` (H2-5) caught a real miss — the new fulfilment route was not in the pinned route allowlist; fixed in the same PR. Lesson recorded: backend slices must update that allowlist; filtered local runs are not enough.
- Two transient `next build` failures (Google Fonts fetch in untouched modules) — each commented on the PR and re-run once; both passed.
- One pre-existing random-key flake in a ZATCA certificate test — fixed in the test.

Codex review (available for H2-1…H2-3, H2-7, H2-8, H2-15; out of usage otherwise → those slices were self-reviewed against the accumulated findings):

| PR | Findings | Examples (all verified, fixed with a test, replied, resolved) |
|---|---|---|
| #1237 H2-1 | 2 | mobile store selector hidden → store now named on small screens; copy |
| #1238 H2-2 | 6 | full timezone list; tabpanel semantics; store-switch and in-app navigation draft loss; label memoisation |
| #1239 H2-3 | 10 | fail-closed preflight; stale dialog close; inactive zones; atomic server revision; snapshot-bound revision; tab-switch confirm |
| #1246 H2-7 | 8 | revision carried through fallback; option-label limits; Unicode counting; fail-closed row mapping; **P1 unpurchasable required choice**; cart-impact warning; failed-refresh handling; outer-tab draft loss |
| #1248 H2-8 | 2 | storefront-visibility hint for add-ons; picker locked during save |
| #1258 H2-15 | 4 | contract omitted `expected_revision`; loose comparison; revision identity hidden by normalisation; stale request-map merge |
| **Total** | **32** | none dismissed |

The lessons from each round were applied proactively to the later sibling sections (add-ons, content, delivery) before their own PRs.

---

## 12. Performance review

- **Opening the product Gifting tab** issues 5 requests (preparation, personalization, add-ons, parent publication, content) plus 2 per add-on row (target product, target publication; +1 variants for variant-managed targets). The add-on limit is **8**, so the worst case is bounded (≈ 5 + 8×3 = 29 small GETs, once per tab open, none repeated on sub-tab switches because all four sections stay mounted). No N+1 on the server: each endpoint reads one document.
- Writes are single transactions per document with a lock; the revision is a hash of already-loaded rows (no extra query).
- The setup centre issues four reads (vertical-setup, gift policy, schedule, fulfilment); a failed secondary read degrades to "no extra explanation" instead of blocking.
- Timezone formatting uses cached `Intl` formatters (the repo guardrail forbids constructing formatters outside `lib/`).
- Not measured: production latency (no production access/verification).

---

## 13. Risks and limitations

1. **Stricter write validation** for active + required choices with no active option (§4.4). Existing data is untouched, but a merchant (or API client) saving such a definition now gets a clear 422. Judged correct (the alternative is an unpurchasable product).
2. **Client-side request fan-out** on the Gifting tab (§12) is bounded but not zero; a future summary endpoint could reduce it if latency becomes visible.
3. **Add-on storefront visibility** is only a *hint* (non-blocking warning from the publication data); the server remains the authority on what shoppers see.
4. **Automated accessibility audit is a regression guard**, not a substitute for assistive-technology testing by a human.
5. **Local dev environment** quirks (stale local app, port reuse) are tooling issues, not product issues; CI is the full-suite gate.
6. **Codex quota**: several slices were self-reviewed rather than bot-reviewed; their risk is mitigated by the rules derived from the 32 earlier findings, the access matrix and the journey contract.

---

## 14. Deferred / evidence-gated domains (not implemented, by design)

Bundles and bouquet composition / BOM / assembly; substitutions; failed-delivery rules beyond existing scheduling; no-address gifting and recipient notification; customer image/file upload for personalization; money/cash gifts; corporate gifting; perishable return/cancellation policy; saved recipients (until the identity/address authority is ready); re-order (until server re-pricing semantics are ready); wishlist (until a shared Commerce capability exists); online/card payment activation and gateway fee/VAT rules; App Builder / mobile gifting administration.

---

## 15. Changed areas

- `app/Http/Controllers/Api/Commerce*` (delivery schedule, fulfilment, personalization, add-on, content controllers), `app/Services/Commerce/*` (delivery schedule, personalization, add-on, content services; `StaleRevisionException`), `routes/api.php`.
- `web/src/modules/commerce-workspace/flowers-admin/**` (gift settings, delivery workspace + panels, product sections, setup centre, onboarding, shared kit), `web/src/app/(commerce)/commerce/{page,onboarding}`, `web/src/app/(app)/products/[id]/page.tsx` (Gifting tab + outer-tab guard), `web/src/components/ui/{dialog,input}.tsx` (opt-in label, aria fix), `web/src/components/layout/topbar.tsx` (accessible name), `web/src/modules/commerce-workspace/{unsaved-registry,store-context}`, `web/src/lib/timezone.ts`.
- Tests: `tests/Feature/{CommerceFulfillmentAdminApiTest,FlowersMerchantAdminAccessMatrixTest,FlowersMerchantAdminJourneyTest,CommerceModuleBoundaryTest,…}`, web vitest suites, 13 Playwright specs + `e2e/helpers/{flowers-admin,a11y-audit}.ts`, `contracts/flowers-admin-journey/**`, CI wiring (`ci.yml`, `web-ci.yml`, `setup.sh`).
- Docs: `ADR-27`, the Horizon 2 ledger and this report.

---

## 16. Recommended next Horizon

1. **Merchant operations & fulfilment visibility for Flowers** — an orders-side view that surfaces gift message, delivery window, personalization values and add-ons per order for the florist's daily prep/dispatch (the data is already captured by Horizon 1; the admin surfaces for *consuming* it are the next adoption gap).
2. **Storefront-facing polish driven by merchant data** — previews of how personalization/add-ons/content appear to shoppers from within the product admin.
3. Only after separate evidence and ADRs: bundles/bouquet composition, saved recipients, re-order.

---

## 17. Deployment state

- **Manual deploy: NOT PERFORMED.** No Deploy / Redeploy / production configuration change was triggered at any point; only the repository-level merges authorised by the execution plan were performed.
- **Automatic CI/CD deployment: UNKNOWN / NOT OBSERVABLE from GitHub.** Railway may auto-deploy `main`; the GitHub API available here exposes CI workflow runs (observed as above) but no Railway deployment status, so no claim is made that production is unchanged **or** that it was updated.
- **Production verification: NOT PERFORMED.** No production URL was exercised; all verification is repository CI plus local browser/API tests.

---

**MERGES: PERFORMED AS AUTHORISED · MANUAL DEPLOY: NOT PERFORMED · AUTOMATIC DEPLOY: NOT OBSERVABLE · PRODUCTION VERIFICATION: NOT PERFORMED**
