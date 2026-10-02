# AWJ POS UI V3 — Visual Direction

**System:** AWJ ERP  
**Area:** Point of Sale / Floor Workspace  
**Status:** DESIGN DIRECTION — no implementation authorization  
**Prepared:** 2026-10-02  
**Planning Base SHA:** `946121cba7b97beed1282498b1fae3c8c0c1e339`

## 1. Purpose

Define the visual and interaction direction for the next AWJ POS experience before any implementation work begins.

This document is intentionally UI/UX-first. It does **not** change accounting semantics, checkout authority, inventory rules, session rules, APIs, database structure, tenant isolation, RBAC, ZATCA behavior, or deployment state.

The current POS already has a strong operational foundation. V3 should primarily **recompose and refine the cashier experience visually**, preserving proven behavior unless a later task explicitly authorizes a functional change.

## 2. Product decision

AWJ POS is a specialized **Floor Workspace**, not a visual clone of AWJ Ledger/ERP screens.

The POS must preserve AWJ identity and shared system semantics, while being free to use a more attractive, tactile, high-clarity cashier experience.

### Keep from AWJ core

- Brand identity and typography family.
- RTL/LTR behavior.
- Financial number formatting and semantic state meanings.
- Accessibility and focus behavior.
- Error, loading, disabled and destructive-action semantics.
- Existing POS accounting/session/security authority.

### POS-specific freedom

- Full-screen operational shell.
- Larger touch targets.
- Stronger product imagery.
- Different surface hierarchy.
- More expressive cart/payment emphasis.
- Faster visual feedback.
- Product density modes.
- Cashier-specific shortcut rail / quick actions.
- Purpose-built responsive behavior.

## 3. Visual character

AWJ ERP should remain calm, dense and formal.

AWJ POS should feel:

- fast;
- polished;
- tactile;
- visually clear;
- modern but not decorative;
- suitable for long cashier sessions;
- attractive enough to be customer-facing at a counter;
- optimized for immediate recognition under time pressure.

The POS must avoid becoming a generic dashboard, an ecommerce storefront, or a card-heavy AI-style interface.

## 4. Primary Sale Workspace

Desktop and landscape tablet use a full-screen cashier composition.

Target proportion:

- Catalog / products: approximately **65%**.
- Cart / transaction: approximately **35%**.

The exact proportion remains responsive rather than a hard pixel contract.

Reference composition:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  AWJ POS      Search / barcode                          Online   User   ⋯   │
├──────────────────────────────────────────────┬─────────────────────────────┤
│                                              │                             │
│  All  Favorites  Drinks  Food  ...          │  Current sale               │
│  ━━━                                         │  Cash customer       Change │
│                                              │                             │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐    │  Coca-Cola 330 ml           │
│   │  IMAGE   │ │  IMAGE   │ │  IMAGE   │    │  2.50 SAR          −  2  + │
│   │ Product  │ │ Product  │ │ Product  │    │                      5.00   │
│   │  12.00   │ │   6.50   │ │   3.00   │    │ ────────────────────────── │
│   └──────────┘ └──────────┘ └──────────┘    │                             │
│                                              │  Subtotal             8.00  │
│                                              │  Discount             0.00  │
│                                              │  Tax                  1.20  │
│                                              │                             │
│                                              │  TOTAL                9.20  │
│                                              │                             │
│                                              │  █████   PAY   ███████     │
├──────────────────────────────────────────────┴─────────────────────────────┤
│ F2 Customer   F4 Discount   F6 Hold   F8 Pay   Invoices   Session         │
└────────────────────────────────────────────────────────────────────────────┘
```

## 5. Topbar

The V3 topbar should be lighter and more cashier-oriented than the current operational header.

Primary hierarchy:

1. AWJ POS identity.
2. Search / barcode field as the dominant central control.
3. Network state.
4. Session / device context.
5. Cashier identity.
6. Overflow menu for secondary actions.

Secondary operations such as recent invoices, returns, exchange, cash drawer, session management, settings and language/theme controls should not visually compete with the sale flow.

The bar must remain fast to scan and usable in both Arabic RTL and English LTR.

## 6. Product catalog

The catalog is the visual discovery area of the cashier screen.

### 6.1 Product tile priority

The default visual hierarchy should be:

1. Product identity.
2. Price.
3. Image where enabled.
4. Cart quantity state.
5. Availability warning only when relevant.
6. Secondary metadata on demand.

Barcode, SKU and detailed stock values should not dominate every tile in normal visual mode.

### 6.2 Three product density modes

#### Compact
For supermarkets, groceries and large catalogs.

- Minimal or no image.
- High product count per viewport.
- Product name + price are dominant.
- Stock warning appears only when actionable.

#### Standard
Recommended default.

- Small/medium image.
- Product name + price clearly visible.
- Balanced density and recognizability.

#### Visual
For restaurants, cafés, flowers, sweets and visually selected catalogs.

- Larger image area.
- Strong product recognition.
- Lower density intentionally accepted.

The cashier should be able to switch display density quickly without entering deep settings.

### 6.3 Added-to-cart state

Adding a product should not generate repetitive intrusive toast messages.

Preferred feedback:

- subtle press/add micro-animation;
- optional sound/haptic feedback;
- quantity badge such as `×2` on the tile;
- cart line updates immediately.

## 7. Categories

Preferred direction: a horizontal category strip above the product grid.

Example:

`All | ★ Favorites | Drinks | Water | Dairy | Food | …`

The strip should:

- support horizontal scrolling;
- keep the active category obvious;
- work well with touch;
- avoid consuming a permanent narrow vertical rail unless testing proves the rail superior.

Final category presentation remains **[OPEN]** pending visual prototype comparison.

## 8. Cart Workspace

The cart should become a strong visual anchor, not a plain administrative table.

Each line should prioritize:

- product name;
- unit price;
- quantity;
- line total.

Quantity controls should be large enough for touch:

`−   2   +`

Secondary operations such as discount, price override and unit change should be exposed through selected-line actions / numeric editor rather than permanently crowding every line.

The cart surface may use stronger contrast than the catalog.

### Open visual decision

**[OPEN] Cart surface:**  
Evaluate light elevated surface vs darker/ink-style surface.

The decision must be based on real visual testing under long cashier use, not aesthetics alone.

## 9. Totals and primary action

The total is one of the strongest visual elements on screen.

Required hierarchy:

- subtotal;
- discount;
- tax;
- grand total;
- primary Pay action.

The grand total may use a larger display size than standard ERP financial values.

The Pay button should be visually dominant, approximately 56–64px high on touch-oriented layouts, and should not compete with multiple equally strong colored actions.

## 10. Cashier Quick Actions

Desktop / keyboard-enabled layouts may expose a restrained shortcut rail.

Initial direction:

- F2 Customer
- F4 Discount
- F6 Hold
- F8 Pay

Labels may adapt by interaction mode.

In Touch mode, keyboard hints may become tappable quick actions instead of remaining passive `kbd` labels.

Final shortcut map remains governed by the existing POS shortcut contract; V3 must not silently change destructive or financial shortcuts.

## 11. Payment Workspace V3

Payment is a dedicated workspace inside the same POS session, not a small modal and not a generic form.

Its purpose is to let the cashier answer three questions instantly:

1. **How much is due?**
2. **How is the customer paying?**
3. **Is anything remaining or due back as change?**

### 11.1 Desktop / landscape composition

Preferred composition:

- approximately **34–38%** transaction summary;
- approximately **62–66%** payment interaction area.

Reference direction:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  ← Back to cart                         Payment                    Online  │
├───────────────────────────────┬────────────────────────────────────────────┤
│                               │                                            │
│  AMOUNT DUE                   │  Payment method                            │
│                               │                                            │
│  129.75 ﷼                    │  ┌────────────┐ ┌────────────┐             │
│                               │  │   Cash     │ │   Card     │             │
│  Customer                     │  │  Banknote  │ │   Mada     │             │
│  Walk-in customer             │  └────────────┘ └────────────┘             │
│                               │                                            │
│  4 items                      │  ┌────────────┐ ┌────────────┐             │
│  ─────────────────────────    │  │ Bank / POS │ │   Other    │             │
│  Product A            45.00   │  └────────────┘ └────────────┘             │
│  Product B            22.50   │                                            │
│  Product C            62.25   │  Received                                  │
│                               │  ┌──────────────────────────────────────┐  │
│                               │  │             150.00                   │  │
│                               │  └──────────────────────────────────────┘  │
│                               │                                            │
│                               │  [ exact ] [ 50 ] [ 100 ] [ 200 ] [ 500 ] │
│                               │                                            │
│                               │  Paid        Remaining        Change        │
│                               │  129.75      0.00             20.25         │
│                               │                                            │
│                               │  █████████ CONFIRM PAYMENT ███████████    │
└───────────────────────────────┴────────────────────────────────────────────┘
```

The composition mirrors correctly in RTL/LTR without changing hierarchy.

### 11.2 Amount due

The amount due is the strongest numerical element on the payment screen.

Rules:

- use large display money typography;
- no decorative animation on the value;
- always show currency;
- retain exact AWJ financial formatting;
- do not bury the total inside a card grid;
- customer identity and item count remain secondary.

The left/summary panel is informative, not interactive-first.

### 11.3 Payment methods

Payment methods should be large, obvious touch targets.

Each method tile should show:

- recognizable icon;
- payment-method name;
- optional short terminal/account hint only when useful;
- selected/applied state;
- entered amount when split payment is active.

Selection must not depend on color alone.

Avoid:

- tiny radio buttons;
- dense form rows;
- one input permanently visible inside every payment-method card;
- making all methods equally visually loud after one is selected.

### 11.4 Single-method payment

For the common case, selecting one method should minimize work.

Preferred behavior:

1. cashier selects Cash / Card / other method;
2. AWJ preselects or proposes the exact remaining amount;
3. cashier confirms directly when no amount editing is needed.

For cash:

- entered cash may exceed due amount;
- change is calculated and displayed prominently.

For non-cash:

- amounts above the allowable remaining amount remain invalid according to current payment semantics;
- the UI explains the state immediately.

### 11.5 Split payment

Split tender remains first-class, but should not make the normal payment case feel complex.

Direction:

- first selected method receives focus;
- entered amount becomes a visible applied line/chip;
- remaining amount updates immediately;
- selecting a second method automatically targets the remaining amount;
- multiple applied methods remain visible in a compact stack.

Example:

```text
Paid
Cash              50.00
Mada               79.75
────────────────────────
Paid              129.75
Remaining           0.00
```

The cashier must always understand which method owns each amount.

### 11.6 Numeric entry / keypad

The keypad should be **contextual**, not permanently consume desktop space unless Touch mode or device configuration benefits from it.

Desktop keyboard mode:

- focus amount input;
- physical numpad works immediately;
- quick amount chips remain available;
- onscreen keypad may stay collapsed.

Touch mode:

- numeric keypad appears as a dedicated large surface;
- keys approximately 56–64px;
- decimal, clear and backspace are visually distinct but not decorative;
- exact amount is a first-class shortcut.

The keypad must never hide the due / remaining / change values.

### 11.7 Quick amounts

Quick amounts are speed controls, not decorative chips.

Preferred set derives from context:

- Exact remaining amount;
- common cash denominations;
- locally appropriate rounded values.

The first action is always the exact remaining amount.

Static values may include 50 / 100 / 200 / 500 SAR where appropriate, but implementation should preserve current payment semantics and avoid silently introducing currency assumptions outside the existing Saudi context.

### 11.8 Paid / Remaining / Change

These three states form a compact financial result strip.

Hierarchy:

- **Remaining** is strongest while payment is incomplete.
- **Change** becomes strongest when cash exceeds the due amount.
- **Paid** remains visible but secondary.

Semantic color may assist, but amount labels and signs remain mandatory.

Example:

```text
Paid            Remaining            Change
129.75          0.00                 20.25
```

When payment is incomplete and deferred payment is not allowed, the Confirm action remains unavailable with a clear reason.

### 11.9 Deferred payment

Deferred payment remains policy-driven and should not appear as a generic extra payment method if that misrepresents the existing accounting model.

UI direction:

- if deferred settlement is permitted and a balance remains, show an explicit **Remaining on account / Deferred** state;
- show the customer identity clearly when deferred balance exists;
- do not expose ledger-account choices to the cashier;
- never imply that unpaid and paid amounts are equivalent.

The exact wording must follow the existing AWJ accounting/payment contract.

### 11.10 Confirm payment

The confirm action is the single dominant action on the payment screen.

Requirements:

- 56–64px touch-oriented height;
- full-width or near-full-width in the payment pane;
- clear amount/status context;
- disabled reason must be understandable;
- while submitting/recovering, interaction is locked against duplicate checkout;
- offline blocking remains explicit.

Do not place another equally dominant primary button beside it.

### 11.11 Success state

Successful payment should feel conclusive but fast.

Preferred feedback:

- immediate success state;
- optional sound/haptic;
- invoice number;
- paid amount / change if relevant;
- concise actions such as Print / New sale / View receipt.

Do not force a long animated celebration.

The next-sale path should be obvious and require minimal movement.

### 11.12 Payment workspace visual hierarchy

The payment surface may be more expressive than Ledger UI, but should still use restrained hierarchy:

- one dominant amount;
- one selected payment-method area;
- one contextual numeric-entry area;
- one financial result strip;
- one primary confirm action.

Avoid a dashboard-like grid of equally weighted cards.

### 11.13 Mobile / portrait direction

On narrow screens, payment becomes a vertical sequence:

1. sticky amount due;
2. payment methods;
3. amount entry / keypad;
4. paid / remaining / change;
5. sticky confirm action.

The item/cart summary collapses behind a compact expandable summary.

The Confirm action respects safe-area insets and remains reachable without scrolling back to the top.

### 11.14 Reuse from current payment implementation

Preserve current proven behavior unless explicitly changed later:

- configured payment methods;
- default payment method;
- cash vs bank settlement semantics;
- split tender;
- exact-amount helper;
- quick amounts;
- change calculation;
- deferred-payment policy;
- payment-method loading/error states;
- offline block;
- checkout submitting/recovering lock;
- current checkout authority and idempotency behavior.

V3 should primarily recompose these behaviors visually instead of replacing them.

## 12. Touch / Responsive POS V3

Responsive POS is not a compressed desktop screen. Each form factor gets a deliberate cashier composition while preserving one interaction model and one transaction state.

### 12.1 Responsive tiers

#### Wide desktop
Recommended target: `>= 1280px`.

- persistent catalog + cart split;
- approximately 65/35 visual balance;
- horizontal category strip;
- Standard or Visual product density;
- full quick-action rail;
- keyboard + pointer + scanner all first-class.

#### Compact desktop / iPad landscape
Recommended target: approximately `900–1279px`.

- persistent catalog + cart split remains;
- cart width protected from over-compression;
- product grid loses columns before touch targets shrink;
- secondary topbar labels collapse to icons / overflow;
- categories stay horizontal and scrollable;
- Standard becomes preferred density;
- all critical targets remain at least 44px.

#### Portrait tablet
Recommended target: approximately `600–899px`.

This is a dedicated two-workspace model:

1. **Products**
2. **Cart**

Products remain the default workspace during item selection.

A persistent bottom transaction bar shows:

- cart item/quantity count;
- current total;
- clear **View cart / Pay** affordance.

Opening Cart uses a **full-height transaction sheet/workspace**, not a narrow desktop side column.

The cart workspace owns:

- customer;
- cart lines;
- selected-line actions;
- totals;
- Pay action.

Returning to Products must preserve search/category position and current cart state.

#### Mobile / handheld
Recommended target: `< 600px`.

Mobile is supported for operational continuity, not treated as the primary high-volume cashier form factor.

Use:

- one primary workspace at a time;
- compact cashier header;
- sticky search;
- horizontally scrollable categories;
- 2-column or density-dependent product grid;
- sticky bottom transaction bar;
- cart as a full-screen sheet/workspace;
- payment as a vertical terminal flow;
- safe-area-aware sticky actions.

No critical action should depend on hover, right-click, or tiny icon-only targets.

### 12.2 Portrait tablet sale workspace

Reference direction:

```text
┌──────────────────────────────────┐
│ AWJ POS    Search / Barcode   ⋯  │
├──────────────────────────────────┤
│ All  Favorites  Drinks  Food →  │
├──────────────────────────────────┤
│ ┌────────────┐ ┌────────────┐   │
│ │  Product   │ │  Product   │   │
│ │   12.00    │ │    6.50    │   │
│ └────────────┘ └────────────┘   │
│ ┌────────────┐ ┌────────────┐   │
│ │  Product   │ │  Product   │   │
│ └────────────┘ └────────────┘   │
│                                  │
│                                  │
├──────────────────────────────────┤
│ 3 items          42.50 ﷼        │
│ [        View cart / Pay       ] │
└──────────────────────────────────┘
```

The bottom transaction bar is persistent whenever the cart is non-empty.

### 12.3 Cart on portrait tablet / mobile

**[DECIDED]** The cart uses a full-height sheet/workspace on portrait tablet and mobile.

It should not use a partial-height bottom sheet for the main editing state because quantity editing, discount, customer, totals and Pay require stable vertical space.

A partial bottom sheet may be used only for quick previews or one-step selectors.

Reference direction:

```text
┌──────────────────────────────────┐
│ ← Products       Current sale    │
│ Cash customer             Change │
├──────────────────────────────────┤
│ Product A                       │
│ 12.00              −   2   +    │
│                           24.00  │
│ ───────────────────────────────  │
│ Product B                       │
│ 18.50              −   1   +    │
│                           18.50  │
│                                  │
│                                  │
├──────────────────────────────────┤
│ Subtotal                  42.50  │
│ Discount                   0.00  │
│ Tax                        6.38  │
│ TOTAL                     48.88  │
│ [            PAY               ] │
└──────────────────────────────────┘
```

### 12.4 Touch target contract

For Touch and AUTO-on-coarse-pointer modes:

- ordinary interactive target: minimum 44×44px;
- primary Pay / Confirm: 56–64px height;
- quantity controls: minimum 44px each;
- keypad keys: 56–64px;
- category tabs/chips: minimum 44px effective height;
- no precision-only overflow triggers smaller than the touch minimum.

Visual density may decrease before target size is reduced.

### 12.5 Product density by form factor

Default recommendation:

- Wide desktop: Standard, user may switch Visual / Compact.
- Compact desktop / landscape tablet: Standard.
- Portrait tablet: Standard with smaller image treatment.
- Mobile: Compact or compact-Standard hybrid.

The user-selected density should persist where practical, but AWJ may safely constrain impossible combinations on narrow screens.

Example: Visual mode on a 390px phone may reduce image height or columns rather than create unusably large tiles.

### 12.6 Search and scanner behavior

Search remains a primary control across every form factor.

Desktop / landscape:

- central header search;
- scanner input may be captured globally according to the existing scanner contract.

Portrait / mobile:

- sticky search field near the top of Products;
- barcode action remains obvious;
- opening Cart or Payment must not destroy scanner/focus state permanently;
- returning to Products restores appropriate focus based on interaction mode.

Touch redesign must not regress HID scanner behavior.

### 12.7 Category behavior

**[DECIDED]** V3 defaults to a horizontal, scrollable category strip.

Reasons:

- preserves catalog width;
- works naturally for touch;
- scales from tablet to mobile;
- avoids a narrow permanent rail consuming valuable space.

For extremely large category sets, V3 may add:

- pinned Favorites / All;
- horizontal scrolling;
- overflow/search category picker.

Do not restore a permanent desktop category rail solely because the current V2 has one.

### 12.8 Sticky transaction controls

On narrow layouts, the bottom transaction bar is a core navigation/state component.

When cart is empty:

- bar may collapse or show a disabled/empty state.

When cart has items:

- item/quantity count;
- live total;
- View cart / Pay action.

The bar:

- respects `safe-area-inset-bottom`;
- never covers the final product row;
- does not obscure system browser/home gestures;
- remains visually separate from product tiles.

### 12.9 Topbar adaptation

The cashier header progressively simplifies.

Priority retained at all sizes:

1. POS identity/context;
2. search or immediate access to search;
3. connectivity;
4. cashier/session access;
5. overflow.

Labels such as Recent invoices, Session management, Returns and Cash drawer move into overflow earlier on narrow layouts.

Do not wrap the topbar into multiple dense rows.

### 12.10 Orientation changes

Rotating a device must not reset:

- cart;
- selected customer;
- selected category;
- search text where practical;
- held-sale context;
- payment inputs during an active payment flow unless existing safety rules require otherwise.

Landscape may recompose from tabbed Products/Cart to split view without creating a second cart state.

### 12.11 Short-height screens

For landscape devices around 768–800px high:

- reduce vertical chrome first;
- reduce product media height second;
- keep 44px interaction targets;
- keep Pay/Confirm visible;
- allow internal panel scrolling rather than whole-page vertical drift.

The cashier should not need browser zoom to complete a sale.

### 12.12 Touch feedback

Touch interactions require immediate non-hover feedback:

- pressed state;
- selected state;
- added quantity badge;
- optional haptic/sound;
- clear disabled state.

Hover may enhance desktop but must never communicate required state by itself.

### 12.13 Payment on portrait/mobile

Payment follows the V3 vertical terminal flow already defined:

1. sticky amount due;
2. payment-method selector;
3. active amount input;
4. contextual keypad;
5. paid / remaining / change strip;
6. sticky Confirm payment.

Cart details collapse behind an expandable summary.

The numeric keypad may occupy most of the lower viewport in Touch mode, but the amount due and financial result remain visible.

### 12.14 Receipt / success on touch

After success:

- success state is immediate and compact;
- change is prominent when applicable;
- Print / Receipt / New sale actions use large targets;
- **New sale** is the primary continuation action;
- the user should not be forced through multiple dismissal layers.

### 12.15 Safe-area and viewport contract

All sticky/footer controls must account for mobile safe areas.

Implementation must verify at minimum:

- iPad landscape;
- iPad portrait;
- 390px-class iPhone viewport;
- 430px-class large iPhone viewport;
- compact desktop around 1024×768;
- standard desktop around 1440px.

No horizontal page overflow is acceptable.

### 12.16 Responsive state ownership

Responsive composition changes presentation only.

It must not create separate business-state owners for desktop vs mobile.

One canonical state continues to own:

- active cart;
- customer;
- session;
- payment;
- selected product/cart line;
- checkout phase.

Responsive components are views over that state, not forks of POS behavior.

## 13. Motion and feedback

Allowed:

- fast press feedback;
- subtle product-add animation;
- quantity badge transition;
- focused cart-line feedback;
- payment success feedback;
- optional sound/haptics.

Avoid:

- decorative transitions;
- slow card animations;
- bouncing totals;
- motion that delays checkout;
- motion that causes accidental duplicate input.

## 14. Reuse of current POS

V3 is **not** a rewrite request.

Preserve unless explicitly changed in a later authorized task:

- dedicated POS workspace;
- session lifecycle;
- cart/session recovery;
- held carts;
- recent invoices;
- barcode handling;
- keyboard/touch/hybrid interaction modes;
- customer selection;
- product variants;
- unit handling;
- discounts;
- price override policy;
- payment methods;
- split tender;
- deferred payment policy;
- receipt flow;
- returns/exchange;
- cash drawer integration;
- connectivity state;
- accounting and checkout authority;
- RBAC / tenant isolation.

The implementation task should prefer composition and styling changes over replacing proven domain behavior.

## 15. Explicit non-goals

This visual direction does not authorize:

- accounting rule changes;
- API redesign;
- database schema changes;
- session model changes;
- ZATCA changes;
- inventory logic changes;
- delivery-platform accounting changes;
- broad POS refactoring;
- merge;
- deploy;
- production release.

## 16. Design references

External POS references may inform patterns, but no repository should be copied as a complete visual system.

Current reference mix:

- Adminium POS: workspace composition and cashier-first structure;
- retail/supermarket POS patterns: catalog density and scanner-first flow;
- existing AWJ POS: operational behavior and interaction foundation;
- AWJ Floor posture: shared semantics with a specialized cashier presentation.

Reference evidence should be treated as inspiration, not a dependency.

## 17. Implementation principle

Before coding:

1. complete the Payment Workspace V3 direction;
2. complete Touch / responsive direction;
3. review the visual composition as a whole;
4. identify exact current components to preserve vs restyle/recompose;
5. execute as small UI-only slices where possible.

Preferred implementation approach:

- ChatGPT: design direction, specification and implementation task definition.
- Cursor: bounded UI implementation slices after approval.
- Claude Code: only if the redesign becomes a broad multi-file architectural refactor.
- Codex / Work: not required for this design phase.


## 18. Visual system decisions

### 18.1 Cart surface

**[DECIDED]** The cart uses a **light high-contrast surface by default**, not a permanently dark/ink panel.

Reasoning:

- long cashier sessions benefit from lower contrast fatigue than a permanent dark block beside a light catalog;
- product/catalog imagery remains visually coherent beside the cart;
- financial hierarchy can be created through typography, spacing, separators and the total/pay area rather than a full dark panel;
- dark mode continues to work naturally through theme tokens instead of introducing a second hard-coded theme inside POS.

The cart still receives stronger visual separation than the catalog through:

- elevated or docked surface role;
- stronger divider;
- slightly different background token;
- stronger total area;
- sticky Pay zone.

A darker **Outcome surface** may still be used locally for the grand-total / payment result area when supported by the Floor tokens, but the whole cart should not become a permanent ink panel.

### 18.2 POS theme behavior

**[DECIDED]** POS follows the user's AWJ light/dark theme, with **Floor-specific tokens and surfaces**.

There is no independent POS theme selector in V3.

This keeps:

- one user preference;
- predictable dark-mode behavior;
- simpler accessibility testing;
- fewer combinations to maintain;
- consistent brand semantics.

Floor-specific visual identity comes from composition, density, media treatment, touch sizing, outcome emphasis and motion — not from a second theme engine.

A future explicit high-contrast Floor option may be added separately if usability testing proves it useful.

### 18.3 Default product density

**[DECIDED]** **Standard** is the V3 default density.

Why:

- it balances visual recognition and catalog throughput;
- it works across retail, flowers, cafés and general merchants;
- it avoids forcing large imagery on supermarkets;
- it avoids making the initial experience feel like a dense text grid.

Rules:

- merchant/user may switch to Compact or Visual;
- narrow screens may constrain impossible combinations;
- the chosen density should persist where practical;
- POS configuration may later provide a store/device default without changing this V3 visual baseline.

### 18.4 Surface hierarchy

The visual order should be recognizable without relying on color:

1. **Catalog surface** — discovery.
2. **Cart dock** — current transaction.
3. **Outcome area** — total / remaining / change.
4. **Primary action** — Pay / Confirm.
5. **Transient overlays** — selectors, numeric editor, quick view.

Avoid stacking multiple card borders inside each other.

### 18.5 Color and emphasis

POS may feel more lively than Ledger, but V3 does not introduce a new brand palette.

Use:

- AWJ primary for active/selected/primary actions;
- semantic colors only for their meanings;
- neutral surfaces for structure;
- product imagery for most visual richness.

Do not use category rainbow colors as decoration. Category color may be used only when deliberately configured and readable.

### 18.6 Corners, shadows and depth

V3 may use slightly softer surfaces than dense Ledger screens, but must stay restrained.

Direction:

- product tiles: medium radius;
- cart/payment dock: clear surface separation;
- overlays/sheets: stronger radius where appropriate;
- shadows: subtle and functional;
- no glassmorphism, glow or gradient-heavy treatment.

### 18.7 Typography

Typography hierarchy should be stronger than Ledger without changing the font family contract.

Priorities:

- product name: clear and short-line readable;
- product price: immediately scannable;
- cart line total: stronger than metadata;
- grand total / amount due: display scale;
- shortcut/helper text: quiet and secondary.

Money remains aligned and formatted through canonical AWJ financial formatting.

## 19. Implementation slicing

V3 should be implemented as small UI-only slices over the current POS foundation.

Recommended sequence:

### POS-UI-V3-1 — Floor shell + topbar + layout
- simplified cashier header;
- 65/35 desktop composition;
- responsive shell;
- no business-logic changes.

### POS-UI-V3-2 — Product catalog
- horizontal category strip;
- Compact / Standard / Visual density;
- simplified tile hierarchy;
- added-to-cart quantity state.

### POS-UI-V3-3 — Cart experience
- cart surface hierarchy;
- simplified cart lines;
- touch quantity controls;
- selected-line action treatment;
- sticky totals / Pay zone.

### POS-UI-V3-4 — Payment workspace
- terminal-like payment composition;
- large method selection;
- contextual amount entry/keypad;
- paid / remaining / change hierarchy;
- success-state refinement.

### POS-UI-V3-5 — Touch / responsive
- portrait tablet Products/Cart workspaces;
- full-height cart sheet/workspace;
- sticky transaction bar;
- mobile payment flow;
- safe-area verification.

### POS-UI-V3-6 — Visual QA and polish
- Arabic RTL + English LTR;
- light + dark;
- Touch / Keyboard-Mouse / Hybrid;
- 390 / 430 / 768 / 1024 / 1440 viewport evidence;
- no horizontal overflow;
- interaction/focus/scanner regression checks;
- final screenshots and implementation report.

Each slice should preserve existing checkout, session, accounting, RBAC, tenant isolation, scanner and payment contracts.


## 20. Open decisions

- [DECIDED] Cart surface is light/high-contrast by default; stronger Outcome treatment is local, not a permanent dark cart panel.
- [DECIDED] Horizontal scrollable category strip is the V3 default; large catalogs use overflow/search rather than a permanent category rail.
- [DECIDED] Standard is the V3 default density; Compact and Visual remain selectable.
- [DECIDED] Portrait tablet/mobile use Products + Cart workspaces; Cart is a full-height sheet/workspace with a persistent bottom transaction bar from Products.
- [DECIDED] Payment Workspace V3 uses a dedicated terminal-like workspace with dominant amount due, large payment-method selection, contextual numeric entry, explicit paid/remaining/change states, and one dominant confirm action.
- [DECIDED] POS follows the user's AWJ light/dark theme with Floor-specific tokens; no independent POS theme selector in V3.

## 21. Current design status

**Approved direction so far:**

- POS may visually differ from AWJ ERP.
- POS is a dedicated cashier / Floor experience.
- Sale Workspace uses product catalog + strong cart composition.
- Approximate desktop composition is 65/35.
- Product presentation supports Compact / Standard / Visual modes.
- Topbar is simplified around sale flow.
- Cart actions are simplified and touch-oriented.
- Total + Pay are visually dominant.
- POS should be more attractive and lively than Ledger screens without losing speed or trust.
- Payment Workspace V3 is a dedicated terminal-like surface, not a small modal or generic form.
- Payment keeps split tender, deferred policy, exact amount, change and checkout safety while simplifying the visual hierarchy.

**Next design step:** prepare the first bounded implementation task for POS-UI-V3-1 (Floor shell + topbar + layout).
