# REAL-MOBILE-PREVIEW — Salla Mobile Builder Benchmark

## Source
User-provided mobile screenshots of Salla App Maker / app customization and preview.

Reference screenshot filenames from this conversation:
- Customization/configuration: `IMG_1057.png` through `IMG_1072.png`
- Full preview examples: `IMG_1166.jpeg`, `IMG_1167.png`, `IMG_1168.png`, `IMG_1169.png`, `IMG_1170.png`, `IMG_1171.jpeg`

These screenshots are treated as UX benchmark evidence only. They do not define AWJ runtime/auth/API behavior.

## What the screenshots show

### A. Mobile customization structure
Salla uses a section/settings-oriented mobile customization flow rather than a free-form canvas for everything.

Observed areas include:
- Home page sections and ordering
- Add-new-section library
- Categories layout and custom category template settings
- Top bar
- Bottom tabs
- App appearance / brand color / dark mode / font
- Splash / welcome screens
- Announcement bar
- Rating message
- Product-card/general settings

Observed section library examples include:
- Offer countdown
- Blog
- Wide banner
- Testimonials
- Carousel
- YouTube video
- Store features
- Static products
- Moving products
- Item/category list
- Store background
- Previous orders

### B. Embedded mini-previews inside settings
Many configuration screens include a small contextual preview of the affected component.

AWJ takeaway:
- Contextual mini-preview is useful while editing a specific setting.
- It does not replace full App Preview.

### C. Full mobile app preview
The preview screenshots show a dedicated, non-editing mobile-app preview inside an iPhone-like frame.

Observed behavior:
- Full app shell rather than a single isolated component.
- Bottom navigation remains visible.
- Merchant can inspect different app destinations/states.
- Preview includes Home, Categories, Cart, Orders, Account.
- A visible `تحديث المعاينة` / refresh-preview action exists.

### D. Important preview states
The screenshots explicitly demonstrate states beyond the happy path:
- populated Home
- Categories with category navigation
- empty category/content state
- empty Cart
- Orders requiring login / no orders
- Account logged-out state

This is important evidence: a useful app preview must represent page/state transitions, not only render the currently selected design node.

## AWJ UX decisions informed by this evidence

### Benchmark decision B1 — Separate editing from full preview
AWJ should preserve:
- Design / Configuration workspace for editing
- App Preview as a dedicated non-editing confidence mode

MP-3 must establish that separation.

### Benchmark decision B2 — Desktop and mobile admin behavior differ
Desktop:
- workspace-integrated App Preview
- professional central device viewport
- optional Full Preview that hides editing chrome

Mobile/tablet admin:
- content-first / full-width preview
- do not render a tiny nested phone inside the user's phone

### Benchmark decision B3 — Preview is app-level, not card-level
The long-term App Preview target must support navigation between app destinations and meaningful page states.

For MP-3:
- establish the shell and non-editing preview mode
- preserve existing safe navigation when already supported
- do not invent runtime semantics

Deeper semantic/navigation parity remains MP-4.

### Benchmark decision B4 — Empty/auth-dependent states are first-class
The preview architecture must account for:
- empty cart
- no orders / auth-required orders
- empty category/content
- logged-out account

MP-3 should avoid blank frames and preserve truthful placeholder/sample states.
Real identity/auth behavior is not implemented in MP-3.

### Benchmark decision B5 — Refresh Preview is a valid pattern
A visible `Refresh Preview` action is acceptable when preview content is based on an explicit Draft snapshot or needs deterministic refresh.

For AWJ:
- do not add a new snapshot/session/auth architecture in MP-3
- MP-3 may expose refresh only if it can safely refresh existing browser preview state without publishing or mutating Draft
- immutable draft snapshot/session semantics remain a later security/runtime decision

### Benchmark decision B6 — Device frame is orientation, not proof
The iPhone-like shell improves confidence and orientation, but must not be presented as native/runtime proof.

AWJ truth labels remain:
- Design Canvas
- Browser Preview
- Real Runtime Preview
- Physical Device Preview

## What AWJ should NOT copy blindly
- Do not make mobile customization a cramped desktop editor.
- Do not equate an iPhone frame with Flutter/native proof.
- Do not silently publish Draft to make preview work.
- Do not forward merchant/admin/store credentials into browser preview.
- Do not create a second independent schema/runtime contract.
- Do not expand MP-3 into Preview Session/auth, QR, Flutter Web, or physical-device work.

## MP-3 impact
This benchmark **clarifies** MP-3; it does not expand its security/runtime scope.

MP-3 should now explicitly ensure:
- App Preview is an app-level shell, not a decorative card.
- Full Preview is a first-class mode on desktop.
- small-screen admin preview is full-width/content-first.
- no blank preview on loading/error/no-published states.
- the implementation remains structurally ready for page navigation and explicit empty/auth-dependent states in MP-4+.
