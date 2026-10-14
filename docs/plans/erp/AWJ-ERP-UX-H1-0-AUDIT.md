# AWJ-ERP-UX-H1-0 — ERP-wide visual, functional and accessibility audit

STATUS: H1-0 AUDIT COMPLETE (documentation only — no product code changed)
DATE: 2026-10-14
Horizon: [AWJ-ERP-UX-H1](./AWJ-ERP-UX-H1.md) · Charter: [AWJ-ERP-UX-H1-CHARTER.md](./AWJ-ERP-UX-H1-CHARTER.md)
Base SHA (audited build and branch base): `22f2ee50bf8ef8592aeab0a352f3bd11b9a1d7b7`
Executor: Claude Code (sole executor for this horizon, per owner direction of 2026-10-14)

## الملخص التنفيذي (عربي)

- جُرد **231 مساراً** في بناء الواجهة خارج `/platform`، وفُحص منها فعلياً **207 عنوان URL تغطي 204 مدخلاً من 231** (203 صفحات + أيقونة الموقع) في متصفح Chromium حقيقي مقابل Laravel حقيقي على بيانات اختبار معزولة، عبر **2,077 تحميل صفحة** إضافةً إلى فحوص تفاعل لوحة المفاتيح: v3 وlegacy، عربي وإنجليزي، فاتح وداكن، وعروض 320 و360 و390 و768 و1440.
- **لا يوجد خلل P0.** لم يُرصد أي خطر على البيانات أو المحاسبة أو العزل أو الصلاحيات من جهة الواجهة.
- **P1 واحد مثبت:** حوار `Dialog` المشترك (123 استخداماً) لا ينقل التركيز إليه، ولا يحبسه، ولا يعيده عند الإغلاق — قارئ الشاشة قد لا يصل إلى الحوار أصلاً.
- أهم P2 مشتركة: القوائم المغلقة قابلة للتركيز وهي مخفية (`aria-hidden-focus`)، تجاوز أفقي **في كل صفحات ERP عند 320px** سببه الشريط العلوي، منطقة التنبيهات (Toast) تخرج عن الشاشة على الجوال، عناصر «قريباً» في الشريط الجانبي روابط إلى صفحات 404، زر إغلاق الحوار يُقرأ «إغلاق» بالعربية في الواجهة الإنجليزية، وحالة «لا صلاحية» تُعرض مع حالة «فارغ» وزر إنشاء في آن واحد، وصفحة تعديل المنتج تتمرر أفقياً 264px حتى على 1440، ومبلغ صافي الدخل في لوحة التحكم يخرج عن بطاقته على عرض 360 ويُقص عند 320.
- كتالوجا الترجمة متطابقان تماماً (9,437 مفتاحاً لكل لغة)، لكن **نحو 150 نصاً عربياً مكتوباً مباشرة في الكود** (12 ملفاً، منها قائمة الفواتير والمنتجات والإشعارات الدائنة/المدينة والموردين) يظهر في الواجهة الإنجليزية، وتنقص 5 تسميات في إعدادات الترقيم.
- **خلل مثبت في اللغة:** بعد التبديل إلى الإنجليزية من الشريط العلوي، مجرد فتح صفحة الإعدادات يعيد الواجهة إلى العربية دون طلب المستخدم.
- **قرار مالك واحد مطلوب** (غير حاجب): أسماء الحسابات الإنجليزية في التقارير تتطلب حقلاً إضافياً في API التقارير — خارج نطاق مهام UX.
- الخطة: 10 شرائح صغيرة مرتبة بالاعتماديات (H1-1 → H1-8)، تبدأ بالمكونات المشتركة لأنها تصلح أكبر عدد من الصفحات بأقل تغيير.

## 1. Method and environment

| Item | Value |
|---|---|
| Backend | Laravel 11 built by `setup.sh` from this repository, SQLite, `php artisan serve` (6 workers) on 127.0.0.1:8000 |
| Frontend | `next build` + `next start` (production build, not dev) of `web/` at the Base SHA, `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api` |
| Browser | Chromium 1194 via playwright-core 1.62.1, headless; `isMobile`+`hasTouch` for ≤390px |
| Automated a11y | axe-core 4.10.2, tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice` |
| Data | One isolated test tenant (`ux-audit`, plan `enterprise`, created-at set before the application-enforcement cut-over so every built capability is enabled), owner role. Seeded **only through the public API**: 28 customers (incl. a 70-character Arabic name and Latin names), 2 suppliers, 4 products (long AR/EN names), 2 purchases (1 posted), 3 sales invoices (2 posted), 1 receipt. No production data, no real tenant, no external credentials. |
| UI modes | v3 gate on (`awj:ui-version=3`, the owner-approved rollout target per `design-system/v3/MIGRATION.md` §9) **and** legacy (gate off — the current default). The crawler recorded the real `data-awj-ui` attribute of every load; it matched the requested mode on every gated page (the only mismatches were the `/icon.ico` favicon route, which is not a page). |
| Matrix | v3: `ar-light-1440`, `en-dark-1440` (axe + screenshots), `ar-light-390`, `en-light-390` (axe + screenshots), `ar-light-320`, `ar-light-768`, `ar-dark-360` (measurements). Legacy: `ar-light-1440`, `ar-light-390` (axe + screenshots), `ar-light-320` (measurements; added after review to evidence the 320 px claim for legacy). |
| Per load | document HTTP status and final path, `/api/*` responses ≥ 400, console and page errors, next-intl `MISSING_MESSAGE`, raw `a.b.c` keys rendered as text, page-level horizontal overflow, elements leaving the viewport, h1 count, heading-level skips, `main` landmark, skip link, visible targets < 24×24 px, unnamed buttons/links, Arabic text in UI chrome while `locale=en`, axe violations |
| Interaction probes | Real keyboard sequences: dialog open → Tab ×40 → Escape (two dialogs, EN); mobile drawer open → Tab ×30 → Escape; desktop Tab count from page top to the first focusable element inside `main`; toast region geometry at 320/390; topbar overflow element-by-element at 320 |
| Static audit | `web/src` excluding `platform` and tests: raw hex, `outline-none` without a focus style, native `window.confirm/alert`, `<label>` linkage, primitive call-site counts, sidebar `href` ↔ build route manifest, message-catalog parity |

Tooling used for the crawl is preserved in [`h1-0-evidence/tools/`](./h1-0-evidence/tools/) so H1-8 can re-run the identical matrix for the before/after comparison. Generated evidence: [`h1-0-evidence/CRAWL-EVIDENCE.md`](./h1-0-evidence/CRAWL-EVIDENCE.md) (all tables) and [`h1-0-evidence/ROUTE-INVENTORY.md`](./h1-0-evidence/ROUTE-INVENTORY.md) (every route).

### Limitations (what H1-0 did NOT verify)

- **No real screen reader** (NVDA/JAWS/VoiceOver/TalkBack). Assistive-technology statements below are derived from DOM/ARIA facts and the WAI-ARIA APG, not from listening.
- **Chromium only.** Firefox and WebKit/Safari not run. No physical device; mobile = Chromium device emulation.
- **Browser zoom / OS text size** not exercised directly. 320 CSS px stands in for 400% zoom at 1280 px (WCAG 1.4.10 equivalence); text-only scaling (200%) not run.
- **One role (owner).** No restricted-role matrix in H1-0; permission-denied states were observed only where the commercial-entitlement gate returned 403 (delivery notes, document center, fuel workspace). Planned for H1-8.
- **27 dynamic detail routes** had no fixture record (e.g. `/quotes/[id]`, `/credit-notes/[id]`, `/hr/employees/[id]`, `/pos/sessions/[id]`) and were not loaded; listed in the route inventory as NOT VERIFIED.
- **Workflows were not executed end-to-end in the browser** (no invoice was created or posted through the UI in H1-0; posting was done through the API to obtain fixtures). Print/PDF previews, exports and the POS sale flow were not inspected beyond their landing pages.
- Performance numbers are local (SQLite, same host); they are only useful relatively.
- External references behind bot challenges (w3.org example pages, salla.com) could not be screenshotted; text sources were used instead (see §8).

## 2. Route & module inventory

Full table: [`ROUTE-INVENTORY.md`](./h1-0-evidence/ROUTE-INVENTORY.md). Summary (routes crawled / exist in build):

| Module group | Crawled | Notes |
|---|---|---|
| Sales (invoices, quotes, credit notes, returns, recurring, payments, refunds, delivery notes/hub/platforms, sales settings) | 32 | `/delivery-notes*` returned 403 (commercial entitlement not granted to the test plan) — see ERP-UX-009 |
| Customers (partners, contacts, CRM, appointments) | 9 | |
| Purchases (requests, RFQ, quotes, orders, bills, returns, debit notes, suppliers, supplier payments/refunds) | 22 | |
| Inventory (products, imports, openings, settings, warehouses, permits, stocktaking) | 22 | |
| Accounting (chart, journals, manual journals, assets, cost centers, accounting settings) | 12 | |
| Finance (expenses, receipt vouchers, cash & bank, custodies, finance settings, alerts, payment methods) | 15 | |
| HR | 1 | `/hr` tabs only; `/hr/employees/[id]` not fixtured |
| Reports | 15 | 4 general statements, customer/purchase aging, inventory value, sales by customer, etc. |
| POS (back-office pages + `/pos` floor) | 12 | Floor posture is a separate shell (`(pos)` group) |
| Documents (center, governance, operations, usage, settings, design, QA) | 7 | Document Center returned 403 (entitlement) |
| Settings & admin (dashboard, settings, tax, numbering, branches, applications, integrations, developer, notifications, help) | 21 | |
| Commerce / App Builder (separate posture, owned by Commerce horizons) | 13 | Audited for shared defects only; changes stay minimal and outside Commerce contracts |
| Fuel stations (separate workspace) | 13 | All data endpoints 403 for the test tenant (entitlement); shell-level findings only |
| Auth / self-service / dev | 12 | `/login`, `/register`, `/me`, dev QA pages |
| **Total** | **207** crawled URLs = **204 of 231** manifest entries (203 pages + the favicon route; the four `/reports/general/*` URLs are one dynamic entry). 27 dynamic entries not fixtured; `/platform/**` and `/api/**` excluded | |

Not-implemented modules shown in the sidebar (no route exists): `/cheques`, `/work-orders`, `/workflow`, `/bookings`, `/rentals`, `/leases`, `/time-tracking`, `/manufacturing`, `/fleet`, `/shipping` (ERP-UX-007). H1 does **not** build these; it only stops them from navigating to a 404.

## 3. Visual UI inventory and design-consistency matrix

Shared building blocks actually used by ERP pages (call sites counted in `web/src`, platform excluded):

| Primitive | File | ERP call sites | Verified state | Deviation from AWJ rules |
|---|---|---|---|---|
| Dialog | `components/ui/dialog.tsx` | 123 | Real-browser keyboard probe | Focus not managed (ERP-UX-001); default close label hard-coded Arabic, only 1 caller overrides it (ERP-UX-002); no scroll lock |
| Dropdown / menu | `components/ui/dropdown.tsx` | shell (notifications, user, quick-create) + row actions | axe + keyboard probe | Closed menu stays in DOM `aria-hidden` but custom children stay focusable (ERP-UX-003) |
| Toast | `components/ui/toast.tsx` | 185 modules call `useToast()` | Geometry probe | Region wider than phone viewport; errors announced politely and vanish after 4 s; close label Arabic only (ERP-UX-004) |
| Sheet | `components/ui/sheet.tsx` (Radix) | 2 | code | Radix handles focus; no defect found |
| Combobox | `components/ui/combobox.tsx` | 20 | code only | Hypothesis H-01: options are `<button role=option>` inside `<li>` with no `aria-activedescendant`; not flagged by axe while closed — verify in H1-2 before changing |
| DataTable | `components/data-table.tsx` | list pages | axe | `aria-sort`, labelled selection, search label present — no defect found |
| Topbar | `components/layout/topbar.tsx` | every ERP page | element probe at 320 | Content ≈ 348 px at 320 px (ERP-UX-005); menu trigger 20 px wide (< 24 px) and no `aria-expanded` (ERP-UX-021) |
| Sidebar | `components/layout/sidebar.tsx` | every ERP page | route-manifest diff + network probe | 10 "soon" items are live links to 404s; their prefetch never settles (ERP-UX-007) |
| App layout | `app/(app)/layout.tsx` | every ERP page | Tab-count probe | `main` and `aside` landmarks present; no skip link — 40 Tab presses from page top to content at 1440 px (ERP-UX-006) |

Token and style conformance (static):

| Rule (DESIGN_SYSTEM.md / v3) | Finding |
|---|---|
| No raw hex in components | 8 occurrences in 7 files; all are color-picker defaults/previews in Store/App Builder, categories color, barcode render — legitimate data colors, not UI chrome. No action. |
| Focus ring on every interactive element | 16 `outline-none` without a focus style on the same element; reviewed: 12 are inner inputs of a composite whose wrapper shows focus (combobox search, POS search, builder canvas). No P1/P2 confirmed; listed P3 for H1-7 review. |
| Money via `formatRiyal` / `SAUDI_RIYAL_SYMBOL` | Screens inspected show `𞸁` and Mono numerals right-aligned; no `ر.س`/`SAR`/`﷼` found in rendered UI. |
| One brand colour, semantic green/red with a sign | Observed in lists and statements; status badges carry text. No violation found. |
| Two fonts | IBM Plex Sans Arabic + Mono only. Mono is also applied to Arabic placeholder text inside numeric inputs, which renders letter-spaced (`ا ل ك م ي ة`) — ERP-UX-018 (P3). |
| Confirmations | 36 native `window.confirm()` calls (post/delete/deactivate in expenses, custodies, cash & bank, manual journals, HR, price lists, product variants) vs in-app confirm dialogs elsewhere — ERP-UX-017 (P3, consistency). Native confirm is functionally safe; nothing is posted without confirmation. |

v3 vs legacy: every finding below reproduced identically in both modes except `link-name` counts (legacy runs fewer workspace pages through the gate). Fixes in shared primitives therefore benefit both modes; none of the planned slices touches the v3 token layer or the gate.

## 4. Interaction and accessibility findings (verified)

Each item: reproduction → expected → actual → evidence. Severity per the charter (§5).

**ERP-UX-001 · P1 · Dialog focus management.** Any page → open a dialog with the keyboard (e.g. `/cost-centers` "New cost center", `/contacts` "Add contact", EN, 1440). Expected (WAI-ARIA APG modal dialog): focus moves into the dialog, Tab/Shift+Tab stay inside, Escape closes, focus returns to the trigger. Actual: focus stays on the trigger outside the dialog; **34/40 and 31/40** Tab presses landed outside the open dialog; after Escape focus was not on the trigger; page behind still scrolls. The dialog declares `aria-modal="true"`, so screen readers restrict reading to the dialog while focus is outside it — a screen-reader user may not reach the form at all. Root cause: `components/ui/dialog.tsx` renders a fixed `div` with only an Escape listener.

**ERP-UX-002 · P2 · Dialog close button named in Arabic in English UI.** Same probe: close button accessible name = `إغلاق` with `locale=en`. Root cause: default prop `closeLabel = 'إغلاق'`; 122 of 123 call sites rely on it.

**ERP-UX-003 · P2 · Closed menus are focusable while hidden.** axe `aria-hidden-focus` (serious) on **168 routes** (674 v3 loads, 337 legacy loads). Mobile keyboard probe on `/invoices`: tab stops 4–6 are `الكل`, an unnamed `DIV`, `عرض كل الإشعارات` — the closed notifications panel. Root cause: `Dropdown` keeps the menu mounted with `aria-hidden`; `DropdownItem` sets `tabIndex=-1` when closed, but custom children (notification list) do not.

**ERP-UX-004 · P2 · Toast region.** At 320 px the toast container measures 332 px (AR) / 359 px (EN, starts at x = −16); at 390 px its right edge is at 400 px. Error toasts use `role=status`/polite and auto-dismiss after 4 s like successes; dismiss button name hard-coded `إغلاق`.

**ERP-UX-005 · P2 · Horizontal overflow on every ERP page at 320 px.** Every route rendered in the `(app)` ERP shell scrolls sideways at 320 px — measured in both modes: v3 167 of 167 shell routes, legacy 168 of 168 (12 px each; `/products/:id/edit` 32 px, see ERP-UX-022). Commerce, Fuel, auth and dev pages use other shells and do not overflow. Element probe: header = 16 px padding ×2 + 20 px menu button + logo + five 44 px action buttons with gaps ≈ 348 px. WCAG 1.4.10 Reflow (AA) failure for the page chrome (not a data-table exception).

**ERP-UX-006 · P2 · No skip link.** 40 Tab presses from page top to the first control in `main` at 1440 px (sidebar + topbar first in DOM). `main`/`aside` landmarks exist, which satisfies SC 2.4.1 via ARIA11, so this is a keyboard-efficiency defect, not a Level A failure.

**ERP-UX-007 · P2 · Sidebar "soon" items navigate to 404.** 10 items flagged `built: false` render as `<Link>`; e.g. `/cheques` renders the bare not-found page (`h1` "404", no `main`, no shell). Next.js prefetches them; on `/accounts`, `/assets`, `/accounting-settings*` the `/cheques` prefetch stayed pending > 8 s, so those pages never reach network-idle (crawler waits hit the 12 s cap).

**ERP-UX-008 · P2 · Raw i18n keys.** `/numbering-settings` document-type select shows `numberingSettings.entity_delivery_note`, `…entity_commerce_order`, `…entity_supplier_refund`, `…entity_customer_refund`, `…entity_pos_investigation_case` in both locales (keys absent from `ar.json` and `en.json`). Catalogs otherwise at full parity (9,437 keys each).

**ERP-UX-009 · P2 · Contradictory forbidden state.** `/delivery-notes` with the capability not entitled: red banner with the raw server text `لا تتوفر صلاحية فعالة لهذه القدرة.` (Arabic even in EN), a **Retry** button that cannot succeed, and below it the empty state "No delivery notes" with a **New delivery note** call to action. Root cause: the page renders `ApiError.message` and does not suppress the empty state when `error` is set. Same server message is the source for other entitlement-gated pages (Document Center, Fuel) — scope verified per page in H1-5.

**ERP-UX-010 · P2 · Unnamed form controls (axe critical).** `select-name` on 15 routes: `/accounting-settings/account-routing` (17 selects), `/debit-notes/new`, `/manual-journals/new`, `/products/new`, `/products/:id/edit`, `/purchase-requests/new`, `/rfq/new`, `/purchase-quotes/new`, `/purchase-orders/new`, `/recurring-invoices/new`, `/stock-permits/new`, `/tax-settings`, `/fuel-stations/alerts|maintenance|safety`. `label` on 15 routes: line-item inputs of the purchase-cycle and quote/recurring forms, `/customer-refunds` and `/supplier-refunds` filters, `/tax-settings`, `/commerce/appearance` (hidden color input). `button-name` on 4: `/cash-and-bank` row-actions trigger and a line-item icon button on `/invoices/new`, `/invoices/:id/edit`, `/quotes/new`. Several of these share line-item editors, so the fix is per shared editor, not per page.

**ERP-UX-011 · P2 · Contrast.** `/applications`: disabled/suspended rows use `opacity-70`, 19 nodes (light) and 73 nodes (dark) below 4.5:1. Isolated nodes on `/finance-settings`, `/inventory-settings`, `/inventory-settings/products`, `/journal-entries/:id`, `/payments/:id`, `/document-qa` (8 routes in v3, 17 in legacy).

**ERP-UX-012 · P2 · Workspace shells: unnamed home link.** `link-name` (serious) on all Commerce/App Builder and Fuel workspace routes (25): the logo link back to `/dashboard` has no accessible name.

**ERP-UX-013 · P2 · DECISION — English account names in reports.** EN trial balance (and other general reports) show Arabic account names. `GET /api/accounts` returns `name_en`, but `GET /api/reports/trial-balance` rows carry only `code, name, type, debit, credit`. Fix needs an **additive API field** → owner decision (see §7). Not changed in this horizon.

**ERP-UX-022 · P2 · Product edit scrolls sideways on every width.** `/products/:id/edit` overflows by **264 px at 1440** (AR and EN, v3 and legacy), 40 px at 768 and 32 px at 320–390. Root cause: `product-media-section.tsx` passes `className="sr-only"` to the shared `Input`, whose own `w-full px-3 border` win over `sr-only`, so the "hidden" file input is absolutely positioned at the width of a distant ancestor. The same pattern exists in `general-payment-form.tsx` and `document-payment-form.tsx` (contained by a relative label there, no overflow measured); `expenses/new` already compensates with `size-px`.

**ERP-UX-024 · P2 · Dashboard KPI amount spills/clips on phones (financial readability).** `/dashboard`, AR light, two-column KPI grid: at 360 px the secondary figure "net income after expenses" (`-10,471.5 𞸁`) runs outside its card; at 320 px its leading digit and the riyal sign are cut by the card edge ([screenshot](./h1-0-evidence/screenshots/v3-ar-light-360-dashboard-kpi-spill.png), [320 px](./h1-0-evidence/screenshots/v3-ar-light-320-dashboard-header-overflow.png)). No value is changed — only its display — but a clipped amount can be misread. Fix is layout-only (wrap/stack the figure below its label or single-column KPIs below a width), never number formatting.

**ERP-UX-027 · P2 · Negative amounts show the minus on the wrong side in Arabic (added after H1-0 merged, found while verifying H1-5C).** In RTL, `-10,471.50 𞸁` printed inside a `.num` element renders as `10,471.50-` — the net loss on the dashboard KPI, the income statement and balance sheet summaries, and the supplier ledger/statement balances (browser probe: 0 of 10 negative amounts on those pages had the sign on the left). design-system/v3 FOUNDATIONS §5 rule 5 requires the sign inside the LTR isolation; the shared `Money` component complies, but these sites print `formatRiyal(...)` strings.

**P3 items (verified):** ERP-UX-014 heading order — card titles render `h3` directly under the page `h1` on 92 v3 routes (93 legacy) — forms and settings built from `Card`, whose `CardTitle` defaults to `h3`. ERP-UX-015 empty `<th>` for row-action columns on 8 list pages (`/invoices`, `/partners`, `/products`, `/purchases`, `/suppliers`, `/warehouses`, `/branches`, `/cash-and-bank`). ERP-UX-023 landmarks: `/pos/audit` renders a second `main` inside the layout `main`; `/fuel-stations/settings` has no `h1`; `landmark-unique` on 8 routes (duplicate unnamed `aside`/`nav`). ERP-UX-016 bidi — Latin names in RTL cells move trailing punctuation to the wrong side (`Al Khobar Trading Est.` renders `.Al Khobar Trading Est` on `/invoices`, 1440 and 390). ERP-UX-017 native `window.confirm` (36 sites). ERP-UX-018 Mono on Arabic placeholders. ERP-UX-019 isolated axe items: `scrollable-region-focusable` (`/developer`, `/developer/security`), `aria-valid-attr-value` (`/commerce/published-products` tab), `svg-img-alt` (`/document-qa`), `link-in-text-block` (`/credit-notes/new`), `landmark-unique` (`/developer/docs`). ERP-UX-020 console errors: invalid SVG `path d` on `/commerce/appearance`. ERP-UX-021 mobile menu trigger without `aria-expanded`/`aria-controls`.

**ERP-UX-025 · P2 · Hard-coded Arabic UI strings appear in the English interface.** Message catalogs are at parity, but ~150 Arabic literals bypass them in 12 ERP files (static scan, [`tools/arabic-literals.py`](./h1-0-evidence/tools/arabic-literals.py), excluding dev pages, digit tables, punctuation and brand name): `pos/settings/shifts` (20), `invoices` list (17 — sort options, search placeholder, the `المتبقي` column header and mobile-card label), `products` list (17 sort options), `reports/report-saved-views` (16), `credit-notes` and `debit-notes` lists (16 each, date-filter labels), `suppliers` (13), `inventory` (11), `inventory-settings/categories` (10), POS dialog close label and walk-in customer name, plus 5 in Commerce/App Builder. Verified visually on `/invoices` in EN ([screenshot](./h1-0-evidence/screenshots/v3-en-dark-1440-invoices-arabic-literals.png)). The crawler's visible-chrome detector undercounts this class (closed `<select>` options, mobile cards), so the static scan is the measure.

**ERP-UX-026 · P2 · The language chosen in the top bar reverts after opening Settings.** Reproduction (real UI login, account preference = Arabic): toggle to English → `/invoices` is English → open `/settings` → next page is Arabic again; the `locale` cookie is back to `ar` ([`tools/probe-locale.cjs`](./h1-0-evidence/tools/probe-locale.cjs)). Root cause: `/settings` (and the security card) refresh the user from `/me` and call `persistUser()`, which re-applies the account's stored locale and theme to the device. The top-bar toggles only change the device. Fix belongs to the shell slice (refreshes must not re-apply display preferences; only sign-in and an explicit save in Settings do). This also contaminated 20 EN loads per EN configuration in the first crawl pass (every route visited after `/settings`); those 40 loads were discarded and re-crawled with the locale re-asserted before each load.

**Not defects (checked and cleared):** apart from ERP-UX-025, Arabic text seen in EN mode was tenant data (customer/product/account names, system-seeded payment-method names) and the intentional `ع` language toggle. 403 responses on Fuel/Document Center/Delivery notes are the commercial-entitlement gate working as designed for the test plan. `422 POST /api/email/verify` on `/verify-email` without a code is expected. No page-level overflow at 360/390/768/1440 other than `/products/:id/edit` (ERP-UX-022). The 404s on `/dev/*` QA pages are expected in a production build (dev-only routes). `/icon.ico` appears in the route manifest but is the favicon, not a page.

## 5. Master UI/UX backlog

Effort: S ≤ ½ day, M ≤ 1½ days. "Accept" = acceptance test that must pass before merge.

| ID | Sev | Area / routes | Root cause | Minimal repair | Slice | Effort | Accept |
|---|---|---|---|---|---|---|---|
| ERP-UX-001 | P1 | Dialog, 123 sites | no focus management | initial focus, Tab containment, focus return, scroll lock in `ui/dialog.tsx`; no prop/API change | H1-2A | M | unit (RTL) + browser probe: 0/40 Tab escapes; focus returns to trigger |
| ERP-UX-002 | P2 | Dialog | Arabic default label | default from `common` catalog | H1-2A | S | EN close name = "Close" |
| ERP-UX-003 | P2 | Dropdown (shell + row menus) | hidden-but-focusable | `inert` while closed | H1-2B | S | axe `aria-hidden-focus` = 0 on crawl; closed panel not in Tab order |
| ERP-UX-004 | P2 | Toast (185 modules) | width math, live region | viewport-safe width, `role=alert` for errors, pause on hover/focus, localized dismiss | H1-2C | S | container ⊂ viewport at 320/390; error announced assertively |
| ERP-UX-005 | P2 | Topbar, all pages | header wider than 320 | tighter mobile spacing, ≥24 px menu target | H1-3A | S | overflowX = 0 at 320 on all ERP routes |
| ERP-UX-006 | P2 | App layout | no skip link | visually-hidden-until-focus skip link to `main` | H1-3A | S | 1 Tab + Enter reaches `main` |
| ERP-UX-021 | P3 | Topbar menu button | missing ARIA | `aria-expanded`/`aria-controls` | H1-3A | S | attribute toggles |
| ERP-UX-007 | P2 | Sidebar | unbuilt items are links | render as non-navigable item with "soon" badge | H1-3B | S | no `<a href>` to unbuilt routes; no pending prefetch |
| ERP-UX-016 | P3 | Tables with party names | missing bidi isolation | `<bdi>`/`dir="auto"` on name cells of verified lists | H1-4A | S | punctuation stays with Latin name |
| ERP-UX-015 | P3 | 8 list pages | empty `<th>` | sr-only "Actions" (shared table header where applicable) | H1-4A | S | axe `empty-table-header` = 0 |
| ERP-UX-022 | P2 | `/products/:id/edit` (+2 payment forms) | `sr-only` overridden by `Input` base classes | visually-hidden file input that keeps label/keyboard behavior | H1-4B | S | overflowX = 0 at 320–1440 |
| ERP-UX-024 | P2 | `/dashboard` ≤ 360 px | fixed two-column KPI layout with inline secondary amount | let the secondary amount wrap under its label / one column below 360 px; formatting untouched | H1-5C | S | no numeric text outside its card at 320/360/390 |
| ERP-UX-027 | P2 | dashboard KPI, income statement, balance sheet, supplier ledger/statement (found during H1-5C) | amounts printed as strings in `.num` without LTR isolation; `Money` already isolates | inline `<bdi dir="ltr">` for numeric text at those sites | H1-4C | S | minus left of digits on all measured negative amounts |
| ERP-UX-023 | P3 | `/pos/audit`, `/fuel-stations/settings`, 8 routes | landmarks/headings | page-local fixes | H1-7B | S | listed axe rules = 0 |
| ERP-UX-009 | P2 | Entitlement-gated lists | raw message + empty state | localized forbidden state, no empty CTA/retry on 403 | H1-5A | S–M | 403 shows one localized state |
| ERP-UX-010 | P2 | 15 + 15 + 4 routes (see §4) | unnamed controls, mostly shared line-item editors | `aria-label`/`htmlFor` from existing visible labels | H1-5B (split by editor if large) | M | axe `select-name`/`label`/`button-name` = 0 on those routes |
| ERP-UX-011 | P2 | `/applications` | opacity on text | muted token instead of opacity for row text | H1-6A | S | axe `color-contrast` = 0 light+dark |
| ERP-UX-012 | P2 | Commerce/Fuel workspace shells | unnamed logo link | `aria-label` | H1-6A | S | axe `link-name` = 0 |
| ERP-UX-008 | P2 | `/numbering-settings` | missing keys | add 5 AR/EN labels | H1-7A | S | no raw keys |
| ERP-UX-025 | P2 | 12 ERP files (~150 strings) | literals bypass catalogs | move to `messages/{ar,en}.json`, one PR per module group | H1-7C… | M | static scan = 0 in converted files; EN screenshot |
| ERP-UX-026 | P2 | shell / `/settings` | `persistUser` on refresh re-applies stored locale/theme | refresh keeps device display preferences; sign-in and explicit save still apply them | H1-3C | S | toggle → `/settings` → next page keeps the chosen language |
| ERP-UX-014 | P3 | 92 v3 routes / 93 legacy routes (full list: CRAWL-EVIDENCE §Routes per axe rule) | shared `CardTitle` defaults to `h3` (`components/ui/card.tsx`) and pages rarely pass `as` | choose the level once (default `h2`, nested sections pass `as="h3"`) and re-crawl all 92 routes; no page-by-page patching | H1-7B | M | axe `heading-order` = 0 on the 92 routes with no new skips elsewhere |
| ERP-UX-019 | P3 | developer, commerce tabs, document-qa, credit-notes/new | misc ARIA | per-item fixes | H1-7B | S | listed axe rules = 0 |
| ERP-UX-018 | P3 | numeric inputs | Mono on Arabic placeholder | placeholder in Sans | H1-7B | S | visual check |
| ERP-UX-017 | P3 | 36 native confirms | inconsistent pattern | in-app confirm dialog per module (after H1-2A) | H1-6B (finance/HR first) | M | no `window.confirm` in converted modules; same request payloads |
| ERP-UX-020 | P3 | `/commerce/appearance` | invalid SVG path | fix path string | H1-7B | S | 0 console errors |
| ERP-UX-013 | P2 | Reports (EN) | API lacks `name_en` | **owner decision**; UI uses `name_en` once returned | — | — | — |
| H-01 | hyp. | Combobox | listbox semantics | verify with keyboard/AT first | H1-2 (verify) | S | — |

## 6. Coverage matrix (H1-0 actual)

| Dimension | Tested | Not tested |
|---|---|---|
| Routes | 207 URLs covering 204 of 231 non-platform manifest entries (203 pages + favicon; 26 dynamic entries via fixtures) | 27 dynamic entries without fixtures |
| Roles | owner | restricted roles (sales, accountant, cashier, self-service) — H1-8 |
| Devices (emulated widths) | 320, 360, 390, 768, 1440 | 1024, 1280 measured only in H1-8; physical devices |
| Locales / directions | AR-RTL, EN-LTR | — |
| Themes | light, dark (v3); light (legacy) | legacy dark; Ink theme |
| Widths per mode | v3: 320, 360, 390, 768, 1440; legacy: 320, 390, 1440 | legacy 360/768 |
| UI modes | v3 gate on; legacy | — |
| States | loaded with data, empty lists, 403 entitlement, 404 | slow network, expired session mid-flow, server 500, validation errors in forms, unsaved changes — H1-5/H1-8 |
| Assistive tech | axe + keyboard probes | real screen readers |
| Browsers | Chromium | Firefox, WebKit |

## 7. Decisions

### External Evidence
- WAI-ARIA APG, *Dialog (Modal) Pattern*: focus moves into the dialog on open; Tab/Shift+Tab do not leave it; Escape closes; focus returns to the invoking element; `aria-modal="true"` only when outside content is truly inert.
- WAI-ARIA APG, *Menu Button*: the button exposes `aria-expanded`.
- WCAG 2.2 SC 2.5.8 Target Size (Minimum, AA): 24×24 CSS px unless spacing/inline/equivalent/UA/essential exceptions.
- WCAG 2.2 SC 2.4.1 Bypass Blocks (A): a skip link **or** ARIA landmarks (ARIA11) are each sufficient.
- WCAG 2.2 SC 1.4.10 Reflow (AA): no two-dimensional scrolling at 320 CSS px; data tables are excepted, but headings, toolbars and page chrome are not.
- Microsoft Learn, *Business Central — Assistive features*: Tab/Shift+Tab between elements, arrow keys inside action areas, Tab between page and confirmation dialogs; headings and table headers exposed semantically.
- SAP UI5 Demo Kit, `sap.m.Table` sample, visually inspected at 1280 and 390 px: below the breakpoint columns pop in as labelled fields under the row title, amounts stay end-aligned with their unit.

### AWJ Decision
- Shared primitives are fixed centrally and conservatively: behavior made correct per APG without new props or changed call signatures (H1-2). This is the "opt-in" rule of the charter applied correctly: the fixes change no business behavior and no request, so a per-site opt-in would only leave 122 dialogs inaccessible.
- Keep the existing table→card mobile pattern (matches the Fiori pop-in evidence); do not introduce horizontal-scroll-only tables.
- Unbuilt modules stay visible with the "soon" badge (DESIGN_SYSTEM.md §الشريط الجانبي) but stop being navigable links.
- Platform H1 findings stay in `docs/plans/platform/`; no ERP slice edits `app/platform/**` or `components/platform/**`.

### Rejected / Not Adopted
- Replacing the custom `Dialog` with Radix Dialog in one move: larger surface (portal, stacking, 123 call sites' layout assumptions) than the defect requires.
- Adding new modules or pages for the "soon" items: out of scope (no backend capability).
- Translating tenant data (account/payment-method names) in the client: data, not chrome; the report-name gap goes to the owner as an API decision.

### Open owner decision (non-blocking)
- **D-ERP-UX-01:** add `name_en` (additive, nullable) to report rows that list accounts so EN reports can show English account names. Backward compatible; touches `ReportService` output shape → outside UX authority. Until decided, EN reports keep showing the stored Arabic name.

## 8. Before/after baseline plan

- Same tooling (`h1-0-evidence/tools/`), same seed method, same matrix. H1-8 re-runs it on the final `main` and diffs per-rule counts: target `aria-hidden-focus` 0, `select-name`/`label`/`button-name`/`link-name` 0 on affected routes, overflow at 320 = 0 on ERP routes, dialog Tab escapes 0/40, toast region inside viewport.
- Each implementation PR records before/after for its own routes at fixed viewport and data (screenshots in its report folder when the change is visual).
- Measured metrics: axe violations by rule, page-level overflow px, Tab presses to reach `main`, dialog Tab escapes, toast region bounds, raw-key count, time to network-idle on pages affected by ERP-UX-007.

## 9. Dependency-safe slice queue

| Order | Slice | Content | Depends on | Files (expected) |
|---|---|---|---|---|
| 1 | H1-0 | this audit (docs) | — | `docs/plans/erp/**` |
| 2 | H1-1 | ERP UI contract + acceptance rubric (docs) | H1-0 merged | `docs/plans/erp/**` |
| 3 | H1-2A | Dialog focus + localized close | H1-0 | `web/src/components/ui/dialog.tsx` (+test) |
| 4 | H1-2B | Dropdown `inert` when closed | H1-0 | `web/src/components/ui/dropdown.tsx` (+test) |
| 5 | H1-2C | Toast region/live region/label | H1-0 | `web/src/components/ui/toast.tsx` (+test) |
| 6 | H1-3A | Skip link, 320 header, menu button ARIA | H1-2B (shell dropdowns) | `app/(app)/layout.tsx`, `components/layout/topbar.tsx` |
| 7 | H1-3B | Non-navigable "soon" sidebar items | H1-0 | `components/layout/sidebar.tsx` |
| 7b | H1-3C | Display preferences kept on refresh (ERP-UX-026) | H1-0 | `lib/auth.ts` (`persistUser` option), `app/(app)/settings/page.tsx`, `components/settings/account-security-card.tsx` |
| 8 | H1-4A / H1-4B | Bidi-safe names + action header labels; product-edit overflow | H1-0 | list pages verified in §4; `product-media-section.tsx`, payment forms |
| 9 | H1-5A / H1-5B / H1-5C | Forbidden state; unnamed controls; dashboard KPI at phone widths | H1-2A (5A only) | affected pages only |
| 10 | H1-6A / H1-6B | contrast + workspace link name; native confirm → dialog (finance/HR) | H1-2A | affected pages only |
| 11 | H1-7A / H1-7B | i18n labels; heading order + misc P3 | — | affected pages + messages |
| 11b | H1-7C… | Hard-coded Arabic UI strings → catalogs (ERP-UX-025), one PR per module group | — | affected pages + messages |
| 12 | H1-8 | regression crawl, role matrix, closure | all merged | `docs/plans/erp/**` |

Critical path: H1-0 → H1-2A → H1-6B. Independent slices (2B, 2C, 3B, 4A, 7A) can proceed in any order from fresh `main`. No slice changes API, database, permissions, accounting, tax, inventory or money formatting.

## 10. Accounting / security / isolation statement

H1-0 changed no code. The audit tenant and data were created only through public API endpoints on a local, isolated database; posting of fixture documents went through the existing services (`LedgerService` via the invoice/purchase post endpoints). No journal-entry, tax, inventory, RBAC, tenant or branch behavior was modified. No finding implies a data, accounting or isolation defect.
