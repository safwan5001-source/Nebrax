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

## 11. Payment Workspace — direction only

Payment is the next major V3 design surface and is **not yet fully specified in this document**.

Current direction:

- payment becomes a purpose-built terminal-like workspace;
- grand total is visually dominant;
- payment methods are large and obvious;
- keypad/input interaction is touch-friendly;
- paid / remaining / change states are immediately readable;
- split payment remains first-class;
- deferred payment remains policy-driven;
- customer/cart summary remains available without competing with tender entry.

A dedicated section will be added after visual design review.

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
- [OPEN] Payment Workspace V3 final layout.
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

**Next design step:** Payment Workspace V3.
