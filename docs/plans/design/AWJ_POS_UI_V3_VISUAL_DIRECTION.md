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

## 12. Responsive behavior

### Desktop / landscape tablet

- split catalog + cart;
- full cashier workflow remains visible;
- product density adapts to width and height;
- no ERP sidebar.

### Portrait tablet / mobile

The exact composition remains **[OPEN]**.

Preferred direction:

- products and cart become explicit workspaces/tabs;
- cart may use a bottom sheet / full-height panel where appropriate;
- primary Pay action remains reachable without precision tapping;
- safe-area behavior is mandatory.

The mobile version must not be treated as a desktop layout merely stacked vertically.

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

## 18. Open decisions

- [OPEN] Cart surface: light vs ink/dark.
- [OPEN] Horizontal category strip vs retained category rail for very large catalogs.
- [OPEN] Exact default density: Standard is preferred, but should be visually validated.
- [OPEN] Portrait tablet/mobile cart composition.
- [DECIDED] Payment Workspace V3 uses a dedicated terminal-like workspace with dominant amount due, large payment-method selection, contextual numeric entry, explicit paid/remaining/change states, and one dominant confirm action.
- [OPEN] Whether POS receives an explicit independent theme preference or follows the user's main theme with Floor-specific surfaces.

## 19. Current design status

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

**Next design step:** Touch / responsive composition V3.
