# AWJ-PLATFORM-UX-H1-1 — Platform console UX specification

Status: **WRITTEN / DESIGN_GATE OPEN BEFORE H1-2**  
No product code in this slice. No merge. No deploy.  
Owner decision: option A from H1-0, approved 2026-10-11, with the three amendments in §1.  
Evidence: [AWJ-PLATFORM-UX-H1-AUDIT.md](./AWJ-PLATFORM-UX-H1-AUDIT.md)  
Base inspected: `main` `4d8e1a66673d970b318514664d383a9c4455e999`

This document is the implementation contract for later slices. It is not approval to start H1-2.

## 1. Owner amendments already decided

| # | Decision | Effect |
|---|---|---|
| 1 | H1-1 is a detailed UX spec and lands before any major UI change | This file. Shell work waits for an explicit approval of **this** spec, not only of option A |
| 2 | Shared danger-button contrast is its own PR | Slice `H1-CONTRAST`. Not inside H1-2. Not an ERP visual restyle |
| 3 | Tenant pagination is high priority | Slice `H1-PAGINATION` is the first code PR after this spec is approved. It does not wait for the shell |

## 2. Product boundary

The console is the internal platform control plane. It is not the tenant ERP.

In scope later, only after the gates in §14:

- One authenticated shell around the five existing destinations.
- Pagination of the tenant list using the API that already exists.
- Dark-mode contrast of the shared danger button, without changing button sizes.
- Later page slices that apply the patterns in §8 without new business rules.

Out of scope for the whole horizon:

- New platform features, including a system-updates screen. The API and the tenant page `web/src/app/(app)/whats-new/page.tsx` stay as they are. No nav item.
- Billing, collections, cash, health charts, or any number that is not returned by the current platform APIs.
- Rendering `Usage.per_tenant` on document operations.
- Moving these pages under `web/src/app/(app)/layout.tsx` or calling `applyAwjUiGate()`. That layout states the v3 gate must not leak into Platform.
- Importing `Sidebar`, `Topbar`, `BranchScope`, or `AuthenticatedCompanyBrowserIdentity`. Those are tenant surfaces.
- New endpoints, schema, or money math. `formatRiyal` and `riyalToMinor` stay the formatters.
- A second token system. Platform stays on the gate-off tokens in `web/src/app/globals.css` (`:root` and `.dark`).

## 3. Information architecture

URLs do not change.

| Destination | URL | Active rule | Notes |
|---|---|---|---|
| Overview | `/platform` | exact | KPI page. Read only |
| Tenants | `/platform/tenants` | prefix `/platform/tenants` | List. Detail is a child, not a sixth nav item |
| Tenant detail | `/platform/tenants/[id]` | falls under Tenants | Plan, trial, access, contracts, commercial, overrides |
| Prices | `/platform/prices` | exact | Versioned price create |
| Integrations | `/platform/integrations` | exact | Secrets and scanners |
| Document operations | `/platform/document-operations` | exact | Retention and usage totals |
| Login | `/platform/login` | no shell | Stays on `AuthShell` |

Login is outside the shell so an unauthenticated operator never sees console navigation. Implementation shape for H1-2, not now: a route group `web/src/app/platform/(console)/` whose `layout.tsx` wraps every authenticated page. `web/src/app/platform/login/page.tsx` stays outside that group. Route groups do not change the URL.

```text
web/src/app/platform/login/page.tsx          no shell
web/src/app/platform/(console)/layout.tsx    shell
web/src/app/platform/(console)/page.tsx      /platform
web/src/app/platform/(console)/tenants/...
web/src/app/platform/(console)/prices/...
web/src/app/platform/(console)/integrations/...
web/src/app/platform/(console)/document-operations/...
web/src/components/platform/platform-shell.tsx
```

H1-2 adds the shell around the current page bodies. It does not delete the existing page headers. Those headers are removed only in the later page slice that owns that screen, after the shell already exposes the same actions. Overview may show two logout controls for one PR. That is accepted. H1-3 removes the overview's private nav and logout.

## 4. Shell architecture

New component only. It does not wrap tenant routes.

Regions:

1. Skip link as the first focusable control: "تخطٍ إلى المحتوى" / "Skip to content", target `#platform-content`.
2. Sidebar (`nav`, `aria-label` from `platformShell.nav`).
3. Top bar.
4. `main#platform-content` with `tabIndex={-1}` so the skip target can take focus.

Breakpoint is Tailwind `lg` (1024px), matching the existing app shell's drawer cutoff.

### Desktop, 1024–1920

```text
+------------------+--------------------------------------+
| لوحة المنصة      |  المسار  ·  اللغة  السمة  الاسم  خروج |
|                  +--------------------------------------+
| نظرة عامة        |                                      |
| المؤسسات         |  page h1 and existing body           |
| الأسعار          |                                      |
| التكاملات        |                                      |
| عمليات المستندات |                                      |
+------------------+--------------------------------------+
        15rem                         min-w-0
```

- Sidebar is visible, in normal flow, width `15rem`, background `bg-surface`, border on the inline-end (`border-e`).
- No icon rail and no collapse control. Unlabeled icons were rejected in H1-0.
- The menu button is not rendered at `lg` and above.
- Content column is `min-w-0 flex-1` so tables scroll inside themselves, not the page.
- Page padding: `p-4 sm:p-6`, plus `pb-[max(1rem,env(safe-area-inset-bottom))]`.

### Tablet, 768–1023, and phone, 320–767

Same drawer. Density inside the page still follows each page's existing `md` / `lg` rules.

```text
+----------------------------------------+
| [=]  لوحة المنصة     ع  سمة  خروج     |
+----------------------------------------+
| page body                              |
+----------------------------------------+

Drawer, when open, covers from the inline-start:
+------------------+
| إغلاق            |
| five links       |
| signed-in name   |
+------------------+
```

- Menu button: `h-11 w-11` (44px), `aria-expanded`, `aria-controls="platform-nav"`, label from messages. Visible only below `lg`.
- Drawer panel: `fixed inset-y-0 start-0 z-40 w-[min(100%,20rem)]`, `bg-surface`, padding includes `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
- Scrim: `fixed inset-0 z-30 bg-black/40`. Click closes. `aria-hidden`.
- When closed below `lg`, the nav has the `inert` attribute, the same idea as `web/src/components/layout/sidebar.tsx`. It is not `display:none` only, so focus cannot sit inside a hidden tree.
- Open: move focus to the close button (`h-11 w-11`). Close by close button, scrim, or Escape. Return focus to the menu button. This copies the ERP `dismissSidebar` order: focus the trigger before hiding the drawer.
- Links are anchors, not `role="menu"`. W3C APG: typical site navigation does not use the menu pattern. See H1-0 external evidence.
- Current destination: `aria-current="page"` on one link. Tenant detail marks Tenants current.
- Choosing a link closes the drawer below `lg`.
- Body scroll locks while the drawer is open (`overflow-hidden` on `document.documentElement` is acceptable if it is removed on close and on unmount).

### Top bar

Height at least 44px for every control. Contents, in inline order:

| Slot | Desktop | Below lg |
|---|---|---|
| Menu | hidden | 44px button |
| Identity | wordmark text "لوحة المنصة" is in the sidebar, not repeated as an h1 | same word beside the menu, `text-sm font-semibold` |
| Breadcrumb | visible, `nav` `aria-label` | hidden below `sm` (640). The page h1 remains |
| Spacer | `flex-1` | `flex-1` |
| Language | existing `LangToggle` (`h-11 w-11`) | same |
| Theme | existing `ThemeToggle` (`h-11 w-11`) | same |
| Name | truncated, `max-w-40`, `title` is the full name, not the only name | hidden below `sm`. The drawer shows the full name |
| Logout | text button, min height 44px | icon-plus-text if it fits; if not, text "خروج" with min height 44px. Never icon-only |

Breadcrumb rules:

- Overview: `لوحة المنصة`
- Section: `لوحة المنصة / المؤسسات`
- Detail: `لوحة المنصة / المؤسسات / {tenant name}`

The detail crumb needs the tenant name. H1-2 may render only the static crumbs (`لوحة المنصة / المؤسسات`) and leave the name to the existing page h1. Do not fetch a second tenant request just for a crumb in the shell PR. H1-4 detail may pass the name into the shell later. Do not block H1-2 on that.

Logout calls the existing `platformLogout()` then `router.replace('/platform/login')`. No new session behavior.

### RTL and LTR

- Direction comes from `<html dir>` (`ar` → `rtl`, `en` → `ltr`). Do not set `dir` on the shell.
- Use logical properties only: `start`, `end`, `ps`, `pe`, `border-e`, `inset-y-0 start-0`.
- One back icon for later page slices: `ChevronLeft` with `rtl:rotate-180`, the same rule already documented in `web/src/components/nebrax/pagination.tsx`. Do not use a raw `←` and do not use `ArrowRight` as "back".
- Sidebar on the inline-start in both directions. Do not pin it to the physical left.

### Light and dark

- Colors are the existing utilities: `bg-background`, `bg-surface`, `text-text`, `text-muted`, `border-border`, `text-primary`, `bg-primary-soft`.
- No hex in `platform-shell.tsx`.
- Do not set `data-awj-ui`. Gate-off rendering stays the platform source of truth.
- `LangToggle` writes the `locale` cookie and refreshes. `ThemeToggle` uses `next-themes`. Both already exist and are the controls login uses. Reuse them. Do not fork a platform-only toggle.
- Selected nav item: `bg-primary-soft text-primary`. Unselected: `text-text` and `hover:bg-primary-soft`. Focus ring is the existing `focus-visible:ring-2 focus-visible:ring-primary`.

## 5. Navigation content

Five links, this order, these icons (Lucide, `aria-hidden`, 16px, beside a visible text label):

| Order | Message key | Icon | href |
|---|---|---|---|
| 1 | `platformShell.overview` | `LayoutDashboard` | `/platform` |
| 2 | `platformShell.tenants` | `Building2` | `/platform/tenants` |
| 3 | `platformShell.prices` | `Tag` | `/platform/prices` |
| 4 | `platformShell.integrations` | `ServerCog` | `/platform/integrations` |
| 5 | `platformShell.documentOperations` | `ShieldCheck` | `/platform/document-operations` |

Arabic defaults: نظرة عامة، المؤسسات، الأسعار، التكاملات، عمليات المستندات.  
English defaults: Overview, Tenants, Prices, Integrations, Document operations.

Keys go in `web/src/messages/ar.json` and `web/src/messages/en.json` under a new `platformShell` namespace. No hardcoded sentences in the component.

There is no sixth link. Contracts, prices of a single tenant, and overrides stay inside the detail page.

## 6. H1-PAGINATION — first code slice

Bug: `web/src/app/platform/tenants/page.tsx` requests `per_page=100` and ignores `pagination`. `PlatformTenantService::list` paginates. Laravel reads `page` from the query string inside `paginate()` without a controller change. Plan and status are **not** server filters. The service accepts search and per-page only.

This PR is frontend only. No PHP edit. No new query parameter for plan or status.

### Behavior

- State: `page` starts at 1, `perPage` starts at 25.
- Request: `/platform/tenants?per_page={perPage}&page={page}` plus `search` when non-empty.
- Render the existing `Pagination` from `web/src/components/nebrax/pagination.tsx` with `page`, `lastPage`, `perPage`, `total`, `onPageChange`, `onPerPageChange`. Options stay the component default `[25, 50, 100]`.
- Show it even when `lastPage` is 1 if `total` is 0 or more, so the count and page size remain visible. The component already handles a single page.
- Search debounce stays 250ms. Any search change sets `page` back to 1 before the request.
- Per-page change sets `page` back to 1.
- If the API returns `current_page` past `last_page`, set `page` to `last_page` (minimum 1) and refetch once.
- Plan and status selects stay, but they filter **the loaded page only**. A visible note, not only a placeholder, says that. Arabic: «التصفية على هذه الصفحة فقط». English: "Filters apply to this page only." Do not imply they scan every tenant.
- Empty state stays the DataTable empty label when the page has no rows.
- Error and retry behavior stay. Retry repeats the same page.
- Do not pass a new `mobileRecord` here. That is a later tenants visual slice. This PR may add the pagination note and the `Pagination` footer only.
- Refresh button: add `aria-label` from the existing refresh message if one exists, or `platformTenants.refresh`. This is a one-line name fix on the control this PR already touches. No other icon-button sweep.

### Acceptance

- With more than 25 tenants, page 2 requests `page=2` and renders those rows.
- `pagination.total` is what the footer count uses, not `rows.length`.
- A tenant that sorts after the first 100 is reachable.
- Changing search does not stay on page 2.
- Plan filter hides a row on this page and does not fetch other pages.
- `tenant-reference-numbers.test.tsx` still passes. Add `web/src/app/platform/tenants/tenants-pagination.test.tsx` that mocks `platformApi` and asserts the query string and the page reset.
- No change to `routes/api.php`, `PlatformTenantController`, or `PlatformTenantService`.

A later API slice may move plan and status to the server. It is not part of this PR and is not required to close the hidden-row bug.

## 7. H1-CONTRAST — separate PR

Defect: `Button` variant `danger` is `bg-negative text-white`. Gate-off dark `--negative` is `#f87171`. White on that fill is 2.77:1. Light `#b91c1c` with white is 6.47:1 and must stay.

v3 already corrects this only under `html[data-awj-ui="3"].dark` (`globals.css` around the "Fixed-white foregrounds" comment) using `--awj-text-inverse` (`#0E1A31` in that dark block). Platform does not set the v3 gate, so the fix does not apply. Do not turn the gate on.

### Change

In the gate-off token block of `web/src/app/globals.css`, not inside `html[data-awj-ui="3"]`:

- `:root { --danger-fg: #ffffff; }`
- `.dark { --danger-fg: #0e1014; }`

`#0e1014` is already the dark `--background`. On `#f87171` its contrast is 6.88:1.

Add a rule that is **less specific** than the v3 rule:

```css
.dark .bg-negative.text-white {
  color: var(--danger-fg);
}
```

`html[data-awj-ui="3"].dark .bg-negative.text-white` stays the winner when the gate is on. Gate-off light mode is untouched because the new rule is under `.dark` only.

Do not remove `text-white` or `bg-negative` from `button.tsx`. The CSS hook depends on those classes. Do not change `sm`, `md`, or `icon` sizes. Do not change `--negative` itself; inline `text-negative` must remain the light red in dark mode.

Hover on the danger variant is `hover:opacity-90`, not a second color pair. No extra hover rule unless a test shows the opacity animation flashes white. It should not.

### Acceptance

- `web/src/components/ui/button.test.tsx` passes, and the danger variant still has the classes `bg-negative` and `text-white`.
- Computed style in dark, gate-off: danger text is `rgb(14, 16, 20)` on `rgb(248, 113, 113)`.
- Computed style in light: text stays white on `rgb(185, 28, 28)`.
- A v3 dark fixture, if one already exists, still resolves to `--awj-text-inverse`, not `--danger-fg`.
- No platform page edit in this PR.

This PR may run in parallel with `H1-PAGINATION`. They do not touch the same files.

## 8. Patterns for later page slices

These are binding when a page is edited. H1-2 does not have to retrofit every page.

### Tables

| Width | Rule |
|---|---|
| ≥768 | Existing table. Horizontal scroll stays on the table wrapper (`overflow-x-auto` or `Table`'s wrapper). The page must not scroll sideways |
| <768 | Card path. Tenant list will pass `mobileRecord` in its visual slice: name and status first, account number, plan, users. Email and phone stay available, after the identity block, not deleted |
| Application overrides | Its visual slice adds the same card split already used by commercial and contract cards. Until then, contained scroll is tolerated |
| Wide commercial table | Already `hidden` below `lg` with cards. Leave that behavior |

Sort and export stay as `DataTable` implements them. Do not fork `DataTable` to restyle ERP. An accessible name for its search input is an additive prop defaulting to the current placeholder, in a PR that runs `web/src/components/data-table.test.tsx`. It is not part of H1-2. Prefer doing it with the tenants visual slice if that slice already edits the call.

### Forms

- One column below `sm`. Existing multi-column grids may start at `sm` or `lg`, never at the default (320px) width.
- Every control has a visible `<label>` or `aria-label`. Placeholder is not the name.
- Errors use `role="alert"` and `text-negative`. Success uses `role="status"`. Do not announce a failed save as status. Document operations must split those in its own slice.
- Price amount stays on `riyalToMinor`. Currency remains SAR. No float.
- Secret fields stay `type="password"` with the current password confirmation the API already requires.
- Primary actions are in normal flow. No new sticky dock that covers the last fields. Safe-area padding on the shell is enough.
- Date and email inputs keep `dir="ltr"` where the value is a code or address. Labels follow the page direction.

### Dialogs

Use `web/src/components/ui/dialog.tsx`. Do not add a second modal system.

`window.confirm` for deactivate, contract cancel, and contract expire is replaced in the detail slice, not in H1-2.

Acceptance for that replacement:

- Dialog title says what will happen.
- Cancel is the first focused button. The page moves focus; do not rewrite `Dialog` unless an optional prop is required and tested.
- Escape and scrim mean cancel. `Dialog` already closes on both.
- On close, focus returns to the button that opened it.
- Confirm uses `variant="danger"` for deactivate, cancel, and expire.
- The request body stays the current PATCH or transition payload. The dialog is not the authorization.
- Global application overrides already have a preview dialog and a server confirmation token. Do not replace that with a thinner confirm.

Known limit, accepted: `Dialog` does not trap Tab today. A focus trap is a shared-component change. It is out of H1-2. The page slice still moves initial focus and restores it. If Tab can leave the dialog, record it as a remaining risk, not as a silent pass.

### Loading, empty, error, forbidden

| State | UI |
|---|---|
| First load | Existing `Skeleton` blocks, not a blank page. Document operations may switch from a text line to a skeleton in its slice |
| Refresh | The current control stays, with `disabled` and the existing spin. Do not replace the whole page with a skeleton if data is already on screen |
| Empty | The existing empty copy. No illustration requirement |
| Error | `role="alert"`, the API message, and a retry button. Integrations' error row gains `flex-wrap` in its slice |
| 403 | A short forbidden panel, not `null` and not the same copy as a network error. Global controls may keep hiding the card on 403 only if the rest of the page is still usable; the silent `return null` becomes a one-line muted note in that slice |
| Demo | Do not change `isDemo()` behavior |

## 9. Per-route notes

| Route | Keep | Later slice may change |
|---|---|---|
| Login | `AuthShell`, Zod form, password toggle, tenant login link | Nothing in H1-2 |
| Overview | Metric fields, `formatRiyal`, contracted-revenue notice, plan table | H1-3: drop private nav and logout once the shell has them. No new charts |
| Tenants | Search, badges, global controls card | Pagination first. Visual `mobileRecord` and filter-server work later |
| Detail | All write actions and audit notice | Dialogs instead of `window.confirm`. Logical back icon |
| Prices | Minor units, mobile cards below `md` | Logical back icon. Stack the save button full-width below `sm` |
| Integrations | Secret fields, admin password, tests | `flex-wrap` on the error row. No secret logged |
| Document operations | Dry-run default, apply checkbox, aggregate totals only | Status vs alert. Replace `←`. Do not render `per_tenant` |

## 10. Acceptance matrix

A slice is not done because the code compiles. The rows marked H1-2 apply only after that slice is allowed to start.

| Check | Pagination PR | Contrast PR | H1-2 shell | Later page PR |
|---|---|---|---|---|
| 320, 768, 1024, 1440, RTL and LTR | list footer wraps, no page overflow | n/a | drawer vs fixed sidebar, no page overflow | that page only |
| Light and dark | tokens only | danger text contrast as in §7 | shell uses tokens | no new hex |
| Keyboard | pagination buttons named | n/a | skip link, drawer Escape, focus return, `inert` when closed | dialogs as in §8 |
| Existing writes still hit the same URLs | yes | yes | yes | yes |
| Tenant session cannot open the shell actions | unchanged client redirect plus existing server 403 | n/a | shell still redirects when `isPlatformAuthenticated()` is false | unchanged |
| Money | untouched | untouched | untouched | formatters unchanged |
| Tests named in §6 or §7 or shell tests | required | required | required | required |

Shell tests, when H1-2 exists: render the five links, `aria-current` on the matching path, login route does not mount the shell, menu button is absent at a `lg` viewport and present below it, Escape returns focus. Use the existing testing-library setup. Do not require a running API.

Viewports the horizon still owes in H1-5, on the real app: 320, 375, 390, 430, 768, 1024, 1440, 1920, both directions, both themes. This spec does not claim those screenshots exist.

## 11. Decisions

### External evidence

Carried from H1-0, not re-litigated:

- WCAG 2.2 SC 2.5.8 AA is 24×24 CSS pixels, with a user-agent exception for native checkboxes. 44px on the new shell controls is an AWJ choice above that floor.
- Disclosure navigation, not ARIA menu: [W3C example](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/).

### AWJ decisions

1. Shell is new and platform-only. Login stays on `AuthShell`.
2. Five destinations. Detail is not a nav item.
3. Drawer below 1024. Fixed 15rem sidebar from 1024 up. No icon rail.
4. Reuse `LangToggle`, `ThemeToggle`, `Pagination`, `Dialog`, `DataTable`, `Button`.
5. H1-2 does not strip page headers.
6. Pagination PR is frontend-only, default 25, filters labeled as in-page.
7. Contrast PR adds `--danger-fg` for gate-off dark fills and does not change sizes or `--negative`.
8. No `per_tenant` rendering. No system-updates nav. No v3 gate.
9. Logical back chevron in later slices.
10. Destructive confirms move to `Dialog` in the detail slice, with the current payloads.

### Rejected

- Putting the console inside the tenant sidebar.
- `role="menu"` for the five links.
- A persistent unlabeled icon rail.
- Fixing contrast by enabling `data-awj-ui="3"` on platform.
- Fixing contrast by changing every `text-white` in the ERP.
- Sending plan/status to an endpoint that does not accept them, or looping every page in the client to fake a global filter.
- New financial charts.

### Still open

None that block H1-PAGINATION or H1-CONTRAST.  
H1-2 stays blocked until the owner explicitly accepts this spec. Option A approved the direction. It did not approve these interaction details.

## 12. Risks

- Moving files into `(console)` can break relative imports and tests that import `./page`. H1-2 must update those imports and run the existing platform tests.
- Two logout buttons on the overview until H1-3. Accepted.
- In-page plan filter can still be misunderstood if the note is easy to miss. The note is a visible sentence, not a tooltip.
- `Dialog` does not trap focus. Recorded in §8.
- Contrast rule must stay weaker than the v3 selector. A reviewer checks specificity on the diff.
- Shared `Button` class names stay, so every gate-off dark danger button gets the new foreground. That is intentional and limited to color.

## 13. What this slice did not do

- No `web/` or `app/` edit.
- No merge, no deploy.
- No live browser of the Next.js app.
- No start of H1-2, H1-PAGINATION, or H1-CONTRAST.

## 14. Next, after explicit approval of this file

1. `H1-PAGINATION` from latest `main`. Its own branch and PR. Stop before merge.
2. `H1-CONTRAST` from latest `main`, parallel if the pagination PR is still open, because the files do not overlap. Stop before merge.
3. Only then H1-2 shell, from latest `main` after those two are either merged or explicitly left behind. Stop before merge.
4. Page slices follow the shell, one page per PR.

Each merge still needs a separate explicit approval. This spec is not that approval.
