# AWJ — Product Create/Edit V2: UX Architecture

**Status:** UX evidence pass + design synthesis — **documentation only**.
Implementation is NOT authorized by this document. No backend, schema, or
API contract change is proposed or required by the recommended workflow
(see §22 for the one dependency that would need separate authorization if
ever pursued).

**Date:** 2026-09-16
**Depends on / must not contradict:**
`AWJ_PRODUCT_VARIANTS_UX_CONTRACT.md`, `AWJ_PRODUCT_CREATE_EDIT_VARIANTS_SCREEN_SPEC.md`,
`AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md` (see §4 for how this
document reconciles their two differing section orders).
**Product Variants domain:** CLOSED. This document does not reopen it —
it only concerns how already-authoritative screens are *arranged* into one
workspace.

---

## 1. Executive Summary

AWJ's Product Create/Edit experience is currently split across three
separate surfaces that overlap in purpose but diverge in capability:
`/products/new` (a full page), `ProductDialog` (a modal used for both
create and edit from several call sites), and `/products/[id]` (a profile
page whose "Edit" button reopens `ProductDialog`, and whose "variants" tab
hosts a fourth, separate component, `ProductVariantsPanel`).

Every backend authority needed for a rich Product — base info, UOM/pricing,
multi-barcode, Options/Variants, media, publication — already has a working
frontend surface *somewhere*. The problem is not missing functionality; it
is **fragmentation**: the same concept (category, media, multi-barcode
pricing) is implemented twice with different data models or different
reachability, and two capabilities (Options/Variants, and barcode/UOM/price
editing) are **only reachable after the Product is saved and, in practice,
after the edit dialog is closed and reopened** — not because of a backend
limitation, but because of how the existing components are wired together
on the frontend.

This document proposes **one Product Workspace** — a single page-level
surface used for both Create and Edit, organized into the same nine
sections in both modes, that keeps the user in place across the "first
save" moment instead of bouncing them between a page, a modal, and a
separate tab. It reuses every existing authoritative component
(`ProductMultiBarcodeTable`, `ProductVariantsPanel`, `ProductPublicationFields`,
the media gallery) unchanged in their data contracts — this is a
**composition and navigation change**, not a rebuild of any pricing,
inventory, barcode, or variant logic.

The one real UX/data-integrity bug found (category/brand modeled as free
text on `/products/new` but as a foreign-key lookup in `ProductDialog`) is
flagged as a fix folded into the foundation PR, because it is a correctness
issue independent of this redesign, not a new feature.

---

## 2. Current-State Evidence

All findings below are drawn from direct reads of `web/src/` at
`origin/main` (SHA in the final report), with `file:line` citations
preserved from the evidence-gathering pass. No claim in this section is
inferred — where UI does not exist, this document says so explicitly
rather than assuming symmetry with the backend.

### 2.1 `/products/new` — `web/src/app/(app)/products/new/page.tsx`

Full-page create form (582 lines). Renders: Arabic/English name, SKU (with
auto-suggested number), primary barcode (+ "generate" helper), type, unit
template select (sets base unit), default sales/purchase unit, **inline
multi-barcode entry** (a "pending rows" list of code/unit/qty/label/price,
added to client state and submitted as `barcodes: []` / `unit_prices: []`
arrays in the **same** `POST /products` body), category/brand as **free
text inputs**, supplier select, description, purchase price, sale price,
tax rate, min_sale_price, profit margin, discount + discount type, sales
account, COGS account, track-inventory checkbox with conditional initial
quantity and reorder level, `ProductPublicationFields` (storefront
selection — interactive pre-save), tags, internal notes, active toggle.
Media is staged client-side and uploaded via a second call
(`POST /products/{id}/media`) immediately after creation succeeds.

**No Options/Variants UI of any kind exists on this page.**

### 2.2 `ProductDialog` — `web/src/components/products/product-dialog.tsx`

Modal used for both create (`product` prop absent) and edit (`product`
prop set), 604 lines. Invoked from: `/products` list (edit only — the
list's "Add" action navigates to `/products/new` instead), `/products/[id]`
(edit, via header "Edit" button), and three unrelated documents
(`invoice-form.tsx`, `purchase-form.tsx`, `quotes/new/page.tsx`) as a
quick "create a product inline while building a line item" picker.

Field set overlaps `/products/new` closely but **category/brand are
foreign-key `<Select>`s** against `/product-categories` and `/brands`
lookup endpoints — a materially different data model from the free-text
inputs on `/products/new` for the exact same concept. `supplier_id` and
`initial_quantity` are entirely absent from this component. Media upload
and `ProductMultiBarcodeTable` are both gated behind `product?.id` and, in
the create flow, **do not appear even immediately after the product is
successfully created in the same dialog session** — the dialog's `product`
prop is controlled by the parent page and stays `null` until the dialog is
closed and reopened against the saved record. `ProductPublicationFields`
is the one section that is not gated — it is interactive before save, with
its write deferred to immediately after creation.

### 2.3 `/products/[id]` — `web/src/app/(app)/products/[id]/page.tsx`

Profile page (369 lines) with tabs: `info` (read-only field summary +
an inline, independently-implemented media gallery — a **second** media
UI, distinct from `ProductDialog`'s), `variants` (delegates entirely to
`ProductVariantsPanel`), `movements` (read-only), `timeline` (placeholder,
not built), `activity` (read-only audit log). None of the `info` tab's
core fields (name, SKU, pricing, accounts, etc.) are inline-editable —
all editing routes through the header "Edit" button, which opens
`ProductDialog`. Alternate barcodes are shown here as a **read-only**
badge list; editing them requires the modal's `ProductMultiBarcodeTable`.

### 2.4 `ProductVariantsPanel` — `web/src/components/products/product-variants-panel.tsx`

587 lines, mounted only on `/products/[id]`'s `variants` tab, requires an
existing `productId` as a hard prop — **never reachable during Create, in
either `/products/new` or `ProductDialog`**. Implements, in full: enable
variant management, Option CRUD, Option Value CRUD (chip-based, Enter to
commit), combination-preview matrix with selective creation
(suggest→review→create, matching the UX Contract), variant SKU edit,
variant active/inactive toggle (single row and bulk multi-select), variant
delete. Its own in-code comment is explicit that it deliberately does
**not** render barcode, UOM, price, or media fields — "columns and details
here are limited to what actually has real authority today: combination,
SKU, status." That authority lives in a different component.

### 2.5 `ProductMultiBarcodeTable` — `web/src/components/products/product-multi-barcode-table.tsx`

422 lines, mounted only inside `ProductDialog`, gated on `product?.id`.
Columns: Unit, Factor (read-only, informational), Barcode, Quantity,
**Price** (editable inline), Variant (a `<Select>` of active variants,
shown only when the product is variant-managed), Actions. Supports
per-variant rows via `product_variant_id`. The component's own doc
comment states the architecture explicitly and correctly: *"the price does
not belong to the row"* — editing price here writes through to
`PUT products/{id}/unit-prices` (a separate endpoint from
`/products/{id}/barcodes`), refetched after every save, with **no
factor × price computation anywhere in the component**. This exactly
matches the approved Multiple-Barcode UX Contract's authority boundary
(barcode is identity/resolution, never pricing truth) and needs no change.

### 2.6 Media

Two separate, independently implemented product-level gallery UIs exist
(`/products/[id]/page.tsx` inline gallery, and `ProductDialog`'s own grid
uploader) — both call the same `/products/{id}/media` endpoints, but are
two different React implementations of the same feature. **Option-value-level
media and exact-Variant media override have zero authoring UI anywhere** —
the only frontend reference to these layers is read-only, inside the POS
variant picker (`pos-variant-picker-dialog.tsx`), which displays a
server-resolved image via `ProductMediaGalleryService` without any client
logic to choose between shared/option-value/variant-exclusive tiers. This
confirms the backend concept exists and is consumed at checkout, but
**there is no evidence of an authoring surface to set it** — this
document does not claim one exists, and does not claim the backend lacks
one either (out of scope per the mission's own instruction not to
re-audit backend architecture); see §22.

### 2.7 UOM / unit price

Base unit/unit-template selection is available and working on
`/products/new`. **Alternate-unit selling price is only editable through
`ProductMultiBarcodeTable`**, which — per §2.2 — is unreachable during
create and only appears in the edit modal after the product already
exists.

### 2.8 Publication

`ProductPublicationFields` — 95 lines, a clean loading/error/empty/ready
state machine over a per-storefront checkbox list. Mounted on both
`/products/new` and inside `ProductDialog`, **unconditionally** (not
gated on `product?.id`) — the only product sub-feature that is genuinely
interactive before the first save. No "online price" or "storefront
category" field exists in this component.

---

## 3. Current UX Matrix

Legend: **IMPLEMENTED** (working, reachable UI) · **PARTIAL** (UI exists
but has a reachability, consistency, or discoverability defect) ·
**BACKEND ONLY** (API/type exists, confirmed no authoring UI) ·
**MISSING UX** (no evidence of either layer) · **N/A**.

| Capability | Create `/products/new` | Edit `ProductDialog` | Profile `/products/[id]` | Backend available? | Current UX quality | Gap / duplication |
|---|---|---|---|---|---|---|
| Arabic name | IMPLEMENTED | IMPLEMENTED | display only | Yes | Good | — |
| English name | IMPLEMENTED | IMPLEMENTED | display only | Yes | Good | — |
| Category | IMPLEMENTED (free text) | IMPLEMENTED (FK select) | display only | Yes (lookup entity) | **PARTIAL** | **Two different data models for the same field** |
| Brand | IMPLEMENTED (free text) | IMPLEMENTED (FK select) | display only | Yes (lookup entity) | **PARTIAL** | Same as Category |
| SKU | IMPLEMENTED (+ suggestion) | IMPLEMENTED (+ suggestion) | display only | Yes | Good | — |
| Primary barcode | IMPLEMENTED (+ generate) | IMPLEMENTED | display only | Yes | Good | "Generate" helper missing in dialog |
| Description | IMPLEMENTED | IMPLEMENTED | not shown | Yes | Good | — |
| Product type (good/service) | IMPLEMENTED | IMPLEMENTED | not shown | Yes | Good | — |
| Inventory tracking flag | IMPLEMENTED | IMPLEMENTED | not shown | Yes | Good | — |
| Initial quantity | IMPLEMENTED | **MISSING** | not shown | Yes | PARTIAL | Only settable at first creation, only on the page variant |
| Base UOM | IMPLEMENTED | IMPLEMENTED | display only (badges) | Yes | Good | — |
| Alternate UOM | IMPLEMENTED (inline, create-time) | IMPLEMENTED (post-save only, via barcode table) | display only | Yes | PARTIAL | Two different UIs for the same concept, one is create-time inline rows, the other a persisted table |
| Conversion factor | IMPLEMENTED (as part of alt-UOM row) | IMPLEMENTED (read-only column) | display only | Yes | Good | — |
| Per-UOM selling price | IMPLEMENTED (inline, create-time) | IMPLEMENTED (post-save, `ProductMultiBarcodeTable`) | not editable | Yes | PARTIAL | Same duplication as alternate UOM |
| Multiple barcode | IMPLEMENTED (inline, create-time) | IMPLEMENTED (post-save only) | read-only badges | Yes | **PARTIAL** | Two different UIs; edit-mode table is unreachable until dialog reopened after save |
| Barcode quantity | IMPLEMENTED | IMPLEMENTED | not shown | Yes | Good | — |
| Variant association | **MISSING** | **MISSING** | IMPLEMENTED (`ProductVariantsPanel`) | Yes | PARTIAL | Only reachable post-save, on a separate route |
| Options | MISSING | MISSING | IMPLEMENTED | Yes | PARTIAL | Same |
| Option values | MISSING | MISSING | IMPLEMENTED | Yes | PARTIAL | Same |
| Combination generation | MISSING | MISSING | IMPLEMENTED (suggest→review→create) | Yes | Good (once reached) | Hard to discover — separate tab, separate route |
| Variant SKU | MISSING | MISSING | IMPLEMENTED | Yes | Good | — |
| Variant activation | MISSING | MISSING | IMPLEMENTED (single + bulk) | Yes | Good | — |
| Variant barcode | MISSING | IMPLEMENTED (in a *different* component from variant management) | not in variants tab | Yes | **PARTIAL** | Requires leaving the Variants tab and opening the Edit modal |
| Variant UOM | MISSING | IMPLEMENTED (same table) | not in variants tab | Yes | PARTIAL | Same |
| Variant price | MISSING | IMPLEMENTED (same table) | not in variants tab | Yes | PARTIAL | Same |
| Product media | IMPLEMENTED (staged, create-time) | IMPLEMENTED (post-save, own grid UI) | IMPLEMENTED (post-save, own gallery UI) | Yes | **PARTIAL** | Two separate implementations (dialog grid vs profile gallery) |
| Option-value media | MISSING | MISSING | MISSING | **Backend concept exists** (consumed read-only by POS) | **BACKEND ONLY** | No authoring UI anywhere |
| Variant-specific media | MISSING | MISSING | MISSING | **Backend concept exists** (consumed read-only by POS) | **BACKEND ONLY** | No authoring UI anywhere |
| Tax rate | IMPLEMENTED | IMPLEMENTED | not shown | Yes | Good | — |
| Accounting accounts (sales/COGS) | IMPLEMENTED | IMPLEMENTED | not shown | Yes | Good | — |
| min_sale_price | IMPLEMENTED | IMPLEMENTED | not shown | Yes | Good | — |
| discount | IMPLEMENTED | IMPLEMENTED | not shown | Yes | Good | — |
| publication / online availability | IMPLEMENTED (pre-save interactive) | IMPLEMENTED (pre-save interactive) | not shown | Yes | Good | Only feature with true pre-save interactivity |
| tags / internal notes | IMPLEMENTED | IMPLEMENTED (notes as `<Input>` not textarea) | not shown | Yes | PARTIAL | Minor control-type inconsistency |
| inventory / reorder fields | IMPLEMENTED | IMPLEMENTED (reorder only, no initial qty) | not shown (stock changes via separate stock-permit flow) | Yes | Good | — |
| supplier | IMPLEMENTED | **MISSING** | not shown | Yes | PARTIAL | Only settable at first creation via the page variant |

---

## 4. Fragmentation Findings

Answering the mission's ten questions directly, from the evidence above:

1. **What can be configured during first creation?** On `/products/new`:
   nearly everything except Options/Variants and variant-scoped media —
   including, unusually, inline multi-barcode/alt-UOM-price rows and
   publication. On `ProductDialog`'s create mode: the same core fields,
   but *without* multi-barcode/alt-UOM rows, media, or supplier/initial-quantity.
   **The two "create" experiences are not equivalent in capability.**

2. **What requires saving first and navigating elsewhere?** Options/Variants
   always (separate route, `/products/[id]`'s `variants` tab). In
   `ProductDialog`, multi-barcode and media *functionally* require a save
   too — not by navigating away, but by the dialog needing to be closed
   and reopened against the now-existing record, which is a worse UX than
   an explicit navigation because it looks like nothing happened.

3. **What is duplicated between `/products/new` and `ProductDialog`?**
   Two independent form implementations of largely the same field set;
   two independent multi-barcode/alt-UOM-price entry mechanisms (inline
   pending rows vs. the persisted table); two independent media upload
   implementations (counting the profile page's gallery, three total).

4. **Different UX patterns Create vs Edit?** Category/brand is the sharp
   case: free text at create, FK lookup at edit — not just a different
   widget, a **different data model** for the identical field. This is
   flagged as a correctness issue, not a stylistic one.

5. **Hard-to-discover-but-working features?** Alternate-UOM pricing and
   per-variant barcode/price (both live inside `ProductMultiBarcodeTable`,
   itself only visible after opening the Edit modal on a saved product);
   Options/Variants (a separate tab on a separate route from where the
   user was editing everything else).

6. **Are Options/Variants managed only from Product Profile?** Yes,
   confirmed — `ProductVariantsPanel` requires a `productId` prop and is
   mounted nowhere else.

7. **Can the user create Color=Black/White, Size=S/M/L and generate
   combinations during initial creation?** **No.** `ProductVariantsPanel`
   is entirely absent from both create surfaces today.

8. **Can each Variant then receive SKU/barcode/UOM/price/image without
   leaving the logical workflow?** Partially. SKU and active-state: yes,
   inside the Variants tab's own detail sheet. Barcode/UOM/price: yes, but
   only by leaving the Variants tab and opening the separate Edit modal —
   a real context switch, not a true "same workflow" experience. Image:
   no UI exists at all today.

9. **Does mobile have a coherent equivalent?** No dedicated mobile flow
   was found in evidence. The shared `DataTable` and `Sheet` components
   used by `ProductVariantsPanel` do have documented responsive behavior
   (cards instead of table rows, full-screen sheet), and
   `ProductMultiBarcodeTable` renders an explicit mobile card layout
   alongside its desktop table — so pieces respond to viewport, but there
   is no dedicated mobile-first *workflow* (e.g. no stepper, no
   mobile-specific navigation) anywhere in the evidence.

10. **Any flows that could imply incorrect pricing/inventory authority?**
    None found. `ProductMultiBarcodeTable`'s own contract is correctly
    implemented — factor is visually and computationally separate from
    price, and price writes through the canonical `unit-prices` endpoint,
    never a barcode-owned field. This is a real strength to preserve, not
    a gap to fix.

**Biggest fragmentation, in order of impact:**
1. Options/Variants creation is impossible during Create — the single
   feature this mission most wants to enable.
2. The category/brand data-model mismatch is a latent correctness bug,
   independent of this redesign.
3. `ProductMultiBarcodeTable` is unreachable immediately after create
   inside the modal, forcing a confusing close/reopen.
4. Three independent implementations of "upload/manage product media."

---

## 5. Final Information Architecture

The three existing authoritative documents propose two *slightly*
different section orders for the same screen:

- `AWJ_PRODUCT_VARIANTS_UX_CONTRACT.md` §3: Basic info → Classification →
  **Options & Variants** → Units & Barcodes → Pricing → Inventory →
  Images → Online Store → Accounting/advanced.
- `AWJ_PRODUCT_CREATE_EDIT_VARIANTS_SCREEN_SPEC.md` §2 (self-declared "the
  UI/UX authority... unless superseded"): Basic info → Classification →
  Images → Selling & purchasing → Units/barcodes/unit prices → Inventory →
  **Options & variants (only when enabled)** → Online store → Accounting →
  Notes.

Per the Screen Spec's own supersession clause, and per the mission's
proposed nine-section grouping (which is closer to the Screen Spec's
order), **this document adopts and supersedes the Screen Spec §2 ordering**
with one evidence-driven refinement: sections 2 ("الوحدات والأسعار") and 3
("الباركود") in the mission's proposed grouping are, in the actual
implemented component (`ProductMultiBarcodeTable`), **one table, not two
separate UIs** — unit, factor, barcode, quantity, and price are columns of
the same row. Splitting them into two IA sections would mean building two
surfaces where the codebase already has a single, contract-correct one.
This document keeps them as two *headings* for scannability (matching the
mission's ask and the approved Multiple-Barcode contract's own "primary
barcode stays simple, expands into a table" pattern) but they render as
one continuous section with an internal anchor, not two independent forms.

**Final section order (desktop and mobile, both Create and Edit):**

1. **المعلومات الأساسية** — Arabic/English name, SKU, primary barcode,
   type, category, brand, description.
2. **الوحدات والأسعار / الباركود متعدد** — base unit/template, sale/purchase
   price, tax, min_sale_price, discount, profit margin, then the collapsed
   "باركود متعدد" action expanding the unit×factor×barcode×quantity×price
   table (§2.5 evidence) — one integrated section, two anchors.
3. **الخيارات والمتغيرات** — collapsed by default for a Simple Product;
   the Options/Variants workflow (§8 below).
4. **المخزون** — tracking flag, initial quantity (Simple only — see §11),
   reorder level; neutral "tracked per variant" messaging when
   variant-managed (per the UX Contract's explicit rule).
5. **الصور والوسائط** — shared gallery now; anchors reserved for
   option-value/variant media if/when that authoring surface is confirmed
   to exist (§22).
6. **الضرائب والمحاسبة** — sales account, COGS account (tax rate is kept
   in §2 next to price, since it's part of the same pricing decision the
   user is already making there — a deliberate deviation from a literal
   reading of the mission list, justified because tax rate has no
   independent workflow of its own in the evidence).
7. **المتجر الإلكتروني** — `ProductPublicationFields`, unchanged.
8. **معلومات إضافية** — supplier, tags, internal notes, active toggle.

This is nine mission-named groupings, with #2/#3 rendered as one
continuous section per evidence, and tax rate co-located with pricing
rather than duplicated into its own visual break.

---

## 6. Desktop UX

Dense, single-scroll ERP workspace — not a wizard, not a multi-step modal.
Sections 1–8 render as stacked panels on one page (Create and Edit alike),
each with a compact heading, not a large card. A **sticky local section
navigator** (left rail or top tab strip, matching the UX Contract's
suggestion) lets the user jump between sections without losing form state
— this is a navigation aid, not separate pages.

- Repeated-row data (multi-barcode/UOM/price rows, the Variants table)
  uses the existing `DataTable` component exactly as today — table is the
  hero, no card-per-row.
- A **sticky Save action bar** persists at the bottom (or top) of the
  viewport, showing unsaved-state ("لم يُحفظ" badge) and disabling
  irrelevant actions before the first save (e.g., "إضافة صورة" for media
  is visible but explains "سيُحفَظ المنتج أولاً" if clicked pre-save,
  rather than being hidden — see §8).
- No unnecessary modals: `ProductDialog` as a *modal wrapper* is retired
  in favor of the same workspace being reachable at `/products/new` (for
  create) and inline within `/products/[id]` (for edit) — see §17 for
  the migration path for the dialog's three quick-add call sites, which
  keep a lightweight modal (name + SKU + price only) for their narrow
  "pick or quick-create a product while building an invoice line" use
  case, since that is a different job-to-be-done from full Product
  authoring.
- Inline expansion (not a new modal) for "باركود متعدد", matching the
  existing, approved pattern.

## 7. Mobile UX

Not a shrunk desktop table. Recommended structure, informed by the
`Sheet`/`DataTable` responsive behavior already proven in
`ProductVariantsPanel` and `ProductMultiBarcodeTable`:

- Same nine sections, but each collapsed into an accordion by default on
  first entry, with **the Basic Information section expanded first** and
  a persistent "Save" affordance always reachable (not buried at the
  bottom of a long scroll).
- The multi-barcode/UOM/price table already renders a card layout on
  mobile (confirmed in evidence) — reuse it, do not redesign it.
- Variant combination review and single-variant editing use the existing
  full-screen `Sheet` pattern (confirmed already responsive) rather than
  a new bottom-sheet component.
- **No stepper is recommended.** The mission allows a stepper only "if
  evidence supports it" — no evidence of a stepper pattern exists
  anywhere in the current codebase, and introducing one here would create
  a *third* distinct interaction paradigm (page / modal / stepper) instead
  of reducing fragmentation. An accordion-of-sections on one scrollable
  page is the smallest change from the current (desktop) pattern that
  still works well at 44–46px touch targets.

## 8. Create Flow

This is the section that resolves the mission's core "product_id before
child resources" question.

**Recommended approach: (A) explicit first Save, refined by the (C)
pattern the codebase already implements for the fields that support it —
not a new Draft Product architecture.**

Evidence in §2.1 shows `/products/new`'s `POST /products` **already
accepts nested `barcodes: []` and `unit_prices: []` arrays atomically in
the same request** — this is Approach C, already real, for exactly the
two sub-resources it is safe for (rows that don't have their own
independent identity/lifecycle before the product exists). This document
recommends:

1. **Section 1 (Basic Information) is fillable immediately**, no
   product_id required — matches today.
2. **Sections 2 (Units/Barcode/Price) and 7 (Publication) stay
   client-side-staged and submit atomically with the first Save**,
   exactly as `/products/new` already does today for barcodes/unit-prices,
   and as both `/products/new` and `ProductDialog` already do for
   publication (via the same-submit-handler follow-up call). This is not
   a new mechanism — it is making `ProductDialog`'s create mode match
   `/products/new`'s already-proven capability, closing the parity gap
   found in §4.1.
3. **The first Save button reads "حفظ" and, on success, keeps the user on
   the same page/workspace** — it does not navigate away and does not
   close a dialog. The now-existing `product_id` is written into the
   workspace's state, and the previously-locked sections (3 Options/Variants,
   5 Media, and any remaining per-product_id parts of section 2) unlock
   **in place**, with no route change and no re-fetch-triggered layout
   reset. This directly fixes the `ProductDialog` "must close and reopen"
   defect (§4, finding 3) without inventing anything — it is Approach A,
   applied consistently, instead of applied inconsistently as today.
4. **Options/Variants (section 3) and Media (section 5) are NOT staged
   client-side before the first save** — they call their existing
   `product_id`-scoped endpoints (`/products/{id}/options`,
   `/products/{id}/variants`, `/products/{id}/media`, etc.) directly, the
   moment the section unlocks. No new atomic multi-resource create
   contract is proposed (that would be a genuine backend change — see
   §22) and no unsafe client-only "pending variant" buffer is invented,
   per the mission's explicit instruction.
5. Before the first Save, sections 3 and 5 render **visibly but
   disabled**, with a one-line inline explanation ("سيُحفَظ المنتج الأساسي
   أولاً لإضافة خيارات ومتغيّرات") rather than being hidden — this keeps
   the full shape of the workspace visible from the start (supports
   discoverability, finding 5 in §4) while being honest about the
   ordering constraint.

This is the smallest safe approach: it reuses two proven mechanisms
(atomic array submission where it already exists; direct
`product_id`-scoped calls where it doesn't) and changes exactly one thing
— keeping the user in the same workspace instance across the save, instead
of routing them to a different page or forcing a dialog reopen.

## 9. Edit Flow

Identical workspace, all nine sections unlocked immediately (the product
already has an id). The only difference from Create is that section 1's
Save button reads "حفظ التغييرات" and there is no locked-section
messaging. `/products/[id]`'s existing read-only tabs (`movements`,
`activity`) and the `timeline` placeholder are **out of scope for this
redesign** — they are not part of the Create/Edit authoring surface and
keep their current tab presentation.

## 10. Options & Variants

Reuses `ProductVariantsPanel` verbatim as the section-3 content — its
suggest→review→create workflow, Option/Value CRUD, and bulk activation
are already correct and already match the UX Contract. The only change is
*where* it renders (inline in the unified workspace instead of a separate
tab on a separate route) and *when* it unlocks (immediately after the
first Save, per §8, instead of requiring a full page navigation to
`/products/[id]`).

**One composition improvement, not a new authority:** the variant detail
`Sheet` currently only exposes SKU and active-state (§2.4). This document
recommends embedding a **filtered view of the existing
`ProductMultiBarcodeTable`** (filtered to that one `product_variant_id`)
inside the same detail sheet, so a user can set a variant's barcode/UOM/price
without leaving the sheet. This is a UI composition change reusing the
existing component and its existing endpoint calls unchanged — it does not
add a new field, a new authority, or a new backend call shape.

Authoritative field map, restated for this document's own record (matches
§2.4/§2.5 exactly, no new claims):

| Field | Currently supported where |
|---|---|
| SKU | `ProductVariantsPanel` detail sheet |
| Barcode | `ProductMultiBarcodeTable` (recommend embedding, §10) |
| UOM | `ProductMultiBarcodeTable` (same) |
| Selling price | `ProductMultiBarcodeTable` (same) |
| Images | **Not currently supported in any authoring UI** — see §22 |
| Active state | `ProductVariantsPanel` detail sheet + bulk actions |

## 11. UOM / Pricing

No change to authority. Base unit/template selection and per-UOM pricing
keep using `ProductMultiBarcodeTable` and the existing unit-template
helper exactly as implemented. The only change is reachability: this
table becomes visible in section 2 of the unified workspace as soon as a
`product_id` exists (immediately after first Save in Create mode, always
in Edit mode) — no new columns, no new price-derivation logic, matching
§4 finding 10 (no authority-boundary risk was found, and none is
introduced).

## 12. Multiple Barcode

Preserved exactly as approved in `AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md`:
primary barcode stays a simple single field in section 1; "باركود متعدد"
expands the same table described in §11/§2.5 inline, in section 2, with
columns الوحدة / معامل التحويل / الباركود / الكمية / سعر البيع / الإجراءات.
Conversion factor remains read-only and visually separate from price;
price continues to write through the canonical per-UOM pricing authority,
never a barcode-owned field.

## 13. Inventory

Section 4 keeps `track_inventory`, `initial_quantity` (Simple products
only — see below), and `reorder_level` exactly as implemented on
`/products/new` today, now also available in the unified Edit workspace
(closing the gap where `ProductDialog` has no `initial_quantity` field at
all — though post-creation quantity changes correctly continue to route
through the existing stock-permit flow, not this field, since that field
is create-time seeding only).

**Variant-managed products:** per the UX Contract's explicit rule, section
4 must never show a writable parent quantity or average cost once
`variant_state = variant_managed`. This document recommends the same
neutral message already specified there: "المخزون يُتابَع لكل متغيّر —
افتح المتغيّرات لمراجعة الكمية لكل تركيبة," replacing the initial-quantity
input entirely once the product becomes variant-managed (which, per
current UX, can only happen after the first Save, since Options/Variants
themselves require a saved product — so no user ever sees this seed field
made irrelevant mid-input; it simply is not offered once section 3 has
been used to enable variant management).

## 14. Media

Section 5 consolidates the two existing product-level gallery
implementations (`/products/[id]`'s inline gallery and `ProductDialog`'s
grid uploader) into **one shared gallery component**, reused by both
Create (unlocked post-save, per §8) and Edit. This is deduplication of an
already-correct feature, not new functionality.

Option-value-level and variant-specific media remain **not authored** in
this design, because no evidence of an authoring endpoint was found (only
a read/resolve path consumed by POS). This document does not add fake UI
for them — per the mission's explicit instruction, and per
`ProductVariantsPanel`'s own precedent of refusing to render fields
without confirmed authority. See §22 for how to proceed if this authority
is confirmed to exist.

## 15. Accounting / Tax

Section 2 keeps tax rate next to price (§5's justified deviation);
section 6 keeps sales/COGS account selection exactly as implemented in
both current forms. No change to accounting authority, cost-view
permission gating, or ledger behavior — this redesign touches presentation
only.

## 16. Commerce Publication

Section 7 reuses `ProductPublicationFields` unchanged — it is already the
one component with correct pre-save interactivity, and is already
positioned late in the mission's proposed order. No field changes; no
"online price" field is invented (matches the mission's "do not show fake
fields" instruction, and §2.8's confirmed absence).

## 17. Permissions

No change to enforcement — all mutations continue to go through the same
endpoints with the same server-side permission checks as today. UI
visibility must continue to follow those checks (hiding a field is never
authorization, per the Screen Spec's own rule): cost-account fields stay
gated by the existing cost-view permission, publication by the existing
Commerce permission. The three quick-add `ProductDialog` call sites
(invoice/purchase/quote line-item creation) are **not migrated** to the
full workspace — they keep a minimal modal (name, SKU, price) scoped to
their narrower permission context, since forcing a full nine-section
workspace into an invoice-line "quick add" would be a regression, not an
improvement.

## 18. Loading / Error / Empty States

`ProductPublicationFields`'s existing loading/error/empty/ready state
machine (§2.8) is the reference pattern for the whole workspace — every
section that fetches its own data (Options/Variants, Multi-barcode/price
rows, Media) should follow the same explicit states rather than a bare
spinner or silent empty render. This is a consistency recommendation, not
a new pattern to invent.

## 19. RTL/LTR

Preserve the existing, correct convention observed across all evidence:
Arabic-primary labels via `useTranslations`, `dir="ltr"` forced on
numeric/code fields (SKU, barcode, prices) with `className="num"` for
alignment, English name field similarly forced LTR. No change recommended
— this is already handled consistently across the surfaces being merged.

## 20. Accessibility

Touch targets ≥ 44–46px on mobile (matches the mission's own stated
target and the existing `Sheet`/`DataTable` component sizing). Sticky Save
bar must remain keyboard-reachable and screen-reader-announced on state
change (unsaved → saved). No new accessibility mechanism is proposed
beyond consolidating onto the existing shared components, which already
carry this behavior.

## 21. Authority Boundaries

Restated for this document's own record, since it is the section most
directly load-bearing for what implementation PRs may and may not do:

- Conversion factor is never used to derive selling price, anywhere in
  this design (matches §2.5/§12 evidence exactly).
- Barcode is never a pricing authority; the multi-barcode table's price
  column continues to write through the canonical per-UOM pricing
  endpoint only.
- Parent-level quantity/average cost is never shown as writable or
  authoritative for a variant-managed product (§13).
- No sibling-variant fallback, no cross-UOM fallback, anywhere — this
  document does not touch pricing resolution logic at all.
- Variant identity (SKU, activation, combination) continues to be owned
  exclusively by `ProductVariantsPanel`'s existing calls; embedding the
  multi-barcode table into its detail sheet (§10) does not change which
  component owns which write.

## 22. Backend Dependencies

**UX DEPENDENCY — NEEDS CONFIRMATION, NOT A CONFIRMED GAP:** Whether an
authoring endpoint exists for option-value-level or exact-variant media
(as opposed to the confirmed read/resolve path consumed by POS). This
document does not implement UI for either layer until that is confirmed,
per §14. If confirmed absent, that would become:

**UX DEPENDENCY — BACKEND CHANGE REQUIRED:** An endpoint to assign/replace
media at the option-value or variant level (e.g.
`POST /products/{id}/option-values/{valueId}/media` and/or
`POST /products/{id}/variants/{variantId}/media`), mirroring the existing
product-level media contract. **Not implemented in this pass.** This is
the only potential backend dependency this document identifies — every
other recommendation reuses existing endpoints exactly as they exist
today.

No other backend, schema, or API contract change is required by this
architecture. The create-flow recommendation in §8 explicitly avoids
requiring a new atomic multi-resource create endpoint by using the
existing atomic array fields where they exist and direct `product_id`-scoped
calls everywhere else.

## 23. Non-goals

- Redesigning `ProductPricingService`, `PriceListService`, barcode
  resolution, accounting, or Tenant Isolation — all untouched.
- Reopening the Product Variants domain — it is closed; this document
  only rearranges where its existing, correct UI renders.
- A new Draft Product backend lifecycle.
- A new atomic "create Product + Options + Variants + Media" endpoint.
- A stepper-based mobile flow (no evidence supports it — see §7).
- Migrating the three quick-add `ProductDialog` call sites to the full
  workspace (§17).
- Building authoring UI for option-value/variant media before its backend
  authority is confirmed (§22).
- Any visual redesign beyond section reorganization and component reuse —
  no new design language, no decorative elements, matching the mission's
  explicit "not marketing-style UI" instruction.

## 24. Acceptance Criteria

1. Create and Edit render the same nine sections in the same order, in
   one workspace, with no modal-vs-page split for full Product authoring.
2. A user can enter Options (اللون: أسود/أبيض) and Sizes (S/M/L), generate
   and select combinations, and see the resulting Variants — all after
   exactly one explicit Save of the base Product, without navigating to a
   different route or reopening a dialog.
3. From a Variant's detail view, a user can set SKU, barcode, UOM, price,
   and active-state without leaving that detail view.
4. Category and brand use one consistent data model (FK lookup) in both
   Create and Edit.
5. `ProductMultiBarcodeTable` is reachable in the same workspace
   instance immediately after the first Save, with no close/reopen step.
6. No pricing/inventory authority statement in this document is
   contradicted by the shipped UI: factor ≠ price, barcode ≠ price
   authority, parent quantity/cost never shown as authoritative once
   variant-managed.
7. No new backend endpoint is required except the one explicitly flagged
   in §22, which remains unimplemented pending confirmation.
8. Mobile renders the same sections as an accordion, reusing the already-responsive
   `DataTable`/`Sheet` behavior, with no new stepper component.
9. All existing frontend tests listed in §2 continue to pass unmodified
   until their owning component is actually touched by an implementation
   PR (see the companion implementation plan for per-PR test obligations).
