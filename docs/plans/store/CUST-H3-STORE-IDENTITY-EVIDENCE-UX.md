# CUST-H3 — Store Identity Studio — Evidence & UX Pass

**Status:** Architecture evidence pass · no implementation authorization  
**Baseline:** `956d9865cd12622cb9fd5190fed5284b8f053e70` (CUST-H2 formally closed)

## 1. Goal

CUST-H3 makes store identity coherent, visual and merchant-language-first.

The merchant should feel:

> أنا أضبط هوية متجري، وليس رموز Theme داخلية.

H3 does **not** replace the CUST-H1 version lifecycle or CUST-H2 page model. Identity is global presentation state inside the same Version and therefore follows the same Draft → Save → Publish/Schedule → Published Snapshot contract.

## 2. Current AWJ reality

Direct repository inspection confirms that AWJ already has a substantial global presentation contract:

- `themePreset`
- `primaryColor`
- `accentColor`
- `fontPreset`
- `density`
- `radius`
- `productCard`
- `branding.displayName`
- `branding.logoDataUrl`
- `branding.compactLogoDataUrl`
- `branding.faviconDataUrl`
- `header.style`

These values already persist inside `StorefrontPresentationConfig`; H3 must reuse this authority rather than invent another settings store.

### Runtime truth today

| Capability | Persistence | Public runtime | H3 classification |
|---|---|---|---|
| Display name | LIVE | LIVE with storefront-name fallback | LIVE |
| Logo | LIVE | LIVE | LIVE |
| Compact logo | LIVE | LIVE where compact header path uses it | LIVE |
| Favicon | LIVE | LIVE through published presentation | LIVE |
| Primary color | LIVE | LIVE through semantic CSS vars | LIVE |
| Radius | LIVE | LIVE through semantic CSS vars | LIVE |
| Accent color | LIVE persistence | **No public semantic consumer found** | GAP — persisted visual no-op |
| Font preset | LIVE persistence | closed enum currently contains only `cairo-geist` | GAP — no real merchant choice |
| Density | LIVE persistence | no public runtime effect proven in current seam | GAP — persisted visual no-op |
| Product card style | LIVE persistence | no public runtime effect proven in current seam | GAP — persisted visual no-op |
| Header style | LIVE | LIVE | LIVE |

`presentationCssVars()` currently derives the public CSS seam from **primary color + radius**. H3 must not claim parity for other tokens until they have a real renderer.

## 3. Existing branding-media decision

AWJ already made a specific owner decision for Store branding media:

- logo / compact logo / favicon may persist as sanitized raster data URLs in presentation JSON;
- each slot is capped;
- SVG is rejected;
- this is not a general media library.

H3 reuses that decision. It does not silently convert branding media into a new object-storage contract.

## 4. External evidence

### Shopify — global theme settings

Shopify documents Theme Settings as store-wide controls, separate from individual section/block settings. Its global settings include logo, favicon, colors, typography and other visual choices. Current reference:

- https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/theme-settings
- https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor

Relevant adaptation for AWJ: identity/global appearance belongs in a clearly distinct global surface while page/section editing remains contextual.

Shopify also describes reusable color palettes/schemes so merchants do not need to manage repeated hex values manually. AWJ should preserve semantic internal tokens while exposing merchant-language choices rather than token names.

### Salla Twilight — global CSS variables and theme settings

Salla's first-party Twilight docs explicitly treat fonts and colors as predominant global theme features and recommend applying shared CSS variables from the master layout for unified styling:

- https://docs.salla.dev/421945m0
- https://docs.salla.dev/421921m0
- https://docs.salla.dev/421879m0

Relevant adaptation for AWJ: keep one global semantic presentation seam and allow the merchant to manipulate approved values through simple controls. Do not fork per-page copies of global identity.

### Evidence boundary

These sources are benchmark evidence, not permission to clone their exact control sets. AWJ decisions below are constrained by AWJ's existing schema, runtime, tenant/security model and CUST-H1/H2 lifecycle.

## 5. UX decision

Create a **Store Identity Studio** as a global editor mode within the existing Customizer, not a separate settings application.

Recommended merchant-facing groups:

1. **هوية المتجر**
   - اسم العرض
   - الشعار
   - الشعار المختصر
   - أيقونة المتصفح

2. **ألوان المتجر**
   - اللون الأساسي
   - presets / quick starts
   - secondary/accent only after it has a defined semantic runtime role

3. **الخطوط**
   - الخط الأساسي
   - خط العناوين only if the schema/runtime truly supports a distinct heading font
   - curated choices first

4. **الشكل والكثافة**
   - استدارة العناصر/الصور
   - الكثافة
   - شكل بطاقات المنتجات
   - compact/standard global header choice where appropriate

Do not show names such as `primaryColor`, `radius`, `fontPreset`, or CSS variable names to merchants.

## 6. Immediate-preview rule

Every control presented as LIVE must visibly change the Canvas immediately and later match the Published public storefront.

A control that saves but has no visible runtime effect is not acceptable as a LIVE H3 control.

Therefore H3 must resolve the current persisted no-op set:

- `accentColor`
- `density`
- `productCard`

Each must become one of:

- **LIVE** with explicit semantic runtime mapping and parity tests; or
- **GATED/hidden** in merchant UI while keeping backward-compatible persistence.

No destructive schema removal is required merely to hide a no-op field.

## 7. Typography decision

### Curated fonts

Curated font presets are allowed only after confirming:

- repository/runtime availability or an approved loading source;
- Arabic + English glyph coverage;
- weights actually used by the storefront;
- licensing;
- loading/performance implications;
- SSR/hydration consistency.

The current one-value `FONT_PRESETS` is not a meaningful merchant choice.

### Custom font upload

**GATED.** It requires a dedicated contract for:

- tenant-scoped media/storage;
- file-type validation;
- size limits;
- metadata / weights;
- licensing responsibility copy;
- CSP/runtime font loading;
- failure/fallback handling.

Do not store arbitrary font binaries inside presentation JSON.

## 8. Color and accessibility contract

- merchant enters/selects brand color, not foreground token math;
- AWJ derives readable foreground/hover/soft variants;
- invalid colors fail closed;
- text/action contrast must remain accessible;
- color alone must not convey selection/status;
- accent must have a named semantic purpose before activation.

## 9. Global-vs-page boundary

Global identity belongs to the Version, not `pagePresentation`.

Switching Home/Product/Category must preserve the same identity settings and Canvas chrome. A page-specific region may choose from allowed global schemes later, but H3 does not create independent Product/Category brand identities.

## 10. Mobile / RTL

The Studio must preserve H1's preview-first mobile model:

- Canvas remains primary;
- selecting Identity opens a bottom sheet/inspector;
- controls remain usable at 390px;
- Arabic RTL and English LTR both supported;
- color, font and logo actions must not depend on hover.

## 11. Explicit non-goals

H3 does not authorize:

- new DB tables or migrations;
- a second presentation API;
- a new Version lifecycle;
- custom CSS;
- custom JavaScript;
- arbitrary uploaded fonts;
- theme marketplace/licensing;
- page-specific identity forks;
- changing commerce truth, product data or accounting behavior.

## 12. Acceptance direction

H3 is complete only when:

- identity controls are coherent and global;
- every LIVE merchant control has Canvas + Published parity;
- no persisted visual no-op is presented as working;
- backward compatibility holds for existing Versions;
- Draft never leaks publicly;
- Save/Publish/Schedule remain H1 authority;
- mobile/desktop + RTL/LTR + accessibility are verified.
