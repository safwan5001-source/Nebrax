# MOBILE-PREVIEW-1 — Evidence & UX Benchmark

**Horizon:** AWJ App Builder — Real Mobile Preview  
**Status:** EVIDENCE PASS / READY FOR REVIEW  
**Repository:** `safwan5001-source/Nebrax`  
**Base SHA:** `0f36355573b3de746211bd1bed0a6f888f0bba0a`  
**Scope:** Product/UX evidence only. No implementation.

---

## 1. Purpose

This pass establishes what “real mobile preview” should mean in AWJ before implementation begins.

The current AWJ Builder already has a web Canvas for authoring and semantic preview. The product gap is not “another editor canvas”; it is a dedicated preview experience that gives the merchant stronger confidence about how the final mobile application behaves, while staying honest about which layer is being shown.

The benchmark therefore focuses on four questions:

1. How do mature builder products separate editing from preview?
2. How do they present mobile layout and live navigation?
3. How can AWJ continue from browser preview to a physical phone safely?
4. What must AWJ not pretend is “native” when it is not?

---

## 2. External evidence

### 2.1 Salla — App Maker

Salla is the strongest regional reference for the user-facing product pattern.

Current official Salla help content says that the App Maker contains a dedicated preview experience and describes it as a way to see how the app will look before subscription, for an experience that “simulates reality”.

Official evidence:
- Salla Help — App design category:
  https://help.salla.sa/subcategory/%D8%AA%D8%B5%D9%85%D9%8A%D9%85-%D8%A7%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D9%82/zwocpbw83fyabe83uead25zy
- Salla Help — Store app design:
  https://help.salla.sa/article/%D8%A7%D8%A8%D8%AF%D8%A3-%D8%A8%D8%AA%D8%B5%D9%85%D9%8A%D9%85-%D8%A7%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D9%82-1/r1igp9c7cfv59jl294p8qqr5
- Salla Help — App launch stages:
  https://help.salla.sa/article/%D9%85%D8%B1%D8%A7%D8%AD%D9%84-%D8%AA%D8%AF%D8%B4%D9%8A%D9%86-%D8%A7%D9%84%D8%AA%D8%B7%D8%A8%D9%8A%D9%82-1/ytgxyrwvcaed0ipkbhihao37

Observed documented product pattern:
- app design and app preview are separate concepts;
- customization covers home, categories, top bar/tabs, product details, welcome/splash screens, and general settings;
- changes are previewed from a dedicated preview area;
- Salla explicitly distinguishes immediate preview from changes that may take time to appear;
- some changes, especially splash/start screens, may require reinstalling the application to see them directly in the app;
- Salla’s launch workflow is separate from design/preview and includes launch/submission stages.

Important implication:
Salla does **not** collapse authoring, preview, and store release into one indistinguishable state.

### AWJ takeaway from Salla

Retain:
- a visibly separate app preview experience;
- preview inside the design workflow;
- a merchant-friendly mental model;
- fast switching between editing and preview;
- honest indication when a change needs a stronger verification mode.

Do not copy:
- any opaque background refresh behavior;
- any wording that implies browser preview is the installed native app;
- any release/submission coupling that would make preview accidentally publish or distribute an app.

---

### 2.2 Shopify — Theme editor and preview separation

Shopify provides a mature editor-preview model even though the target is web storefront rather than native mobile apps.

Official evidence:
- Theme editor feature overview:
  https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/features-overview
- Preview inspector:
  https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/preview-inspector
- Adding and previewing themes:
  https://help.shopify.com/en/manual/online-store/themes/adding-themes

Observed documented product pattern:
- structural editing lives in sidebars;
- the center preview updates as changes are made;
- mobile preview is an explicit switch;
- preview inspector can be toggled on/off;
- full-width preview is available by collapsing editor panels;
- unpublished content is clearly labeled as Draft;
- preview can be opened separately from editing;
- preview links can be shared without publishing;
- Shopify distinguishes visitor previews from merchant previews;
- preview links can have explicit expiry windows.

Important implication:
The strongest UX is not just “draw a phone frame”; it is to distinguish:
- editing state,
- preview state,
- published state,
- shareable preview state,
- authenticated merchant preview state.

### AWJ takeaway from Shopify

Retain:
- clear Design / Preview mode;
- full-preview mode where editor chrome can disappear;
- Draft / Published labeling;
- share/open preview as a separate action;
- expiring preview-session concept;
- different trust levels for merchant preview vs public/visitor preview if AWJ ever needs both.

Do not copy:
- Shopify’s exact theme-specific URL/session semantics;
- public visitor preview until AWJ defines the security and tenant-isolation contract;
- storefront-specific assumptions that do not fit native mobile runtime.

---

### 2.3 Flutter — browser embedding feasibility

Flutter officially supports web as a deployment target and documents embedding Flutter views inside an existing web application.

Official evidence:
- Flutter web support:
  https://docs.flutter.dev/platform-integration/web
- Embedding Flutter in a web application:
  https://docs.flutter.dev/platform-integration/web/embedding-flutter-web
- Deep linking:
  https://docs.flutter.dev/ui/navigation/deep-linking

Observed platform facts:
- Flutter can compile the same application codebase for the browser;
- Flutter supports full-page web mode;
- Flutter can be embedded using an iframe;
- Flutter also supports embedded/multi-view approaches;
- Flutter supports deep linking on iOS, Android, and web;
- a web build still runs under browser platform constraints, not native iOS/Android platform behavior.

Important implication:
A **Flutter Web Preview** can materially increase UI/runtime parity and may reuse more real runtime code, but it must still be labeled as browser runtime, not exact native-device execution.

### AWJ takeaway from Flutter

Retain as a serious candidate:
- Flutter Web as the rendering engine for Browser App Preview, if the current AWJ mobile runtime can be adapted without creating a second contract;
- iframe or contained embedded mode as an implementation option;
- shared navigation/deep-link semantics.

Do not assume:
- web rendering proves every native behavior;
- native plugins/platform APIs behave identically;
- browser viewport equals real device;
- physical-device verification becomes unnecessary.

---

### 2.4 Apple — secure app opening from web

Apple documents Universal Links as the preferred secure connection between a website and installed application.

Official evidence:
- Allowing apps and websites to link to your content:
  https://developer.apple.com/documentation/Xcode/allowing-apps-and-websites-to-link-to-your-content
- Supporting associated domains:
  https://developer.apple.com/documentation/Xcode/supporting-associated-domains
- Supporting universal links:
  https://developer.apple.com/documentation/Xcode/supporting-universal-links-in-your-app

Observed platform facts:
- Universal Links are standard HTTP/HTTPS links;
- an installed app can open directly in the requested context;
- if the app is not installed, the browser can handle the URL instead;
- the app and web domain must establish a verified association;
- Apple explicitly warns that incoming link parameters are an attack surface and must be validated.

Important implication:
A future “Preview on iPhone” flow should prefer a verified HTTPS link / Universal Link path over an unsafe ad-hoc mechanism.

### AWJ takeaway from Apple

Retain:
- HTTPS deep-link entry point;
- verified domain/app association;
- strict parameter validation;
- safe browser fallback;
- no sensitive action executed merely because a URL was opened.

---

### 2.5 Android — trusted App Links

Android recommends App Links for verified website-to-app deep linking.

Official evidence:
- Create deep links:
  https://developer.android.com/training/app-links/create-deeplinks
- About App Links:
  https://developer.android.com/training/app-links/about

Observed platform facts:
- deep links can launch specific in-app destinations;
- verified Android App Links associate AWJ-controlled domains with the installed app;
- verified links can route directly to the app without ambiguous app selection;
- Android’s association mechanism is designed for trusted web-to-app transitions.

Important implication:
The QR/open-on-phone flow should be based on an HTTPS preview link that can become:
- Universal Link on iOS;
- App Link on Android;
- browser fallback otherwise.

---

## 3. Evidence synthesis

The benchmark consistently supports four separate product layers:

### Layer 1 — Design
Merchant edits pages, sections, blocks, properties, and settings.

Primary goal:
**authoring efficiency**

### Layer 2 — Browser App Preview
Merchant stops editing and experiences the application in a phone-oriented viewport.

Primary goal:
**visual and interaction confidence**

Possible rendering technologies:
- current React contract renderer;
- Flutter Web reuse;
- another shared rendering shell.

The implementation choice belongs to MOBILE-PREVIEW-2/3, but the UX contract is now clear.

### Layer 3 — Real Runtime Preview
The preview is executed by the actual AWJ Flutter runtime rather than a browser approximation.

Primary goal:
**runtime confidence**

### Layer 4 — Physical Device Preview
Merchant opens the preview on a real iPhone/Android device using a short-lived, tenant-bound session.

Primary goal:
**device confidence**

---

## 4. AWJ product decision

### Decision MP1-D1 — Keep Design and Preview visibly separate

The Builder must expose two primary modes:

- **تصميم / Design**
- **معاينة التطبيق / App Preview**

The current Canvas remains the Design surface.

The App Preview surface must not expose edit handles, selection outlines, drag controls, or inspector behavior unless the user explicitly returns to Design mode.

**Decision:** ACCEPTED.

---

### Decision MP1-D2 — Device preview is content-first, not chrome-first

A phone frame may be used for orientation, but the preview must maximize useful application area.

Do not build a decorative device mockup that consumes too much screen space.

Desktop target:
- central mobile viewport;
- optional iOS / Android device style;
- scale-to-fit;
- full-screen preview option.

Mobile/tablet administration target:
- preview should use the available screen instead of nesting a tiny phone inside a phone.

**Decision:** ACCEPTED.

---

### Decision MP1-D3 — Preview truth must be explicit

AWJ will not use one generic “Live Preview” label for different proof levels.

Recommended visible states:

- **Browser Preview**
- **Runtime Preview**
- **On-device Preview**

Arabic:
- **معاينة المتصفح**
- **معاينة التشغيل**
- **معاينة على الجهاز**

Internal architectural labels may remain more technical, but merchant-facing language must be clear.

**Decision:** ACCEPTED.

---

### Decision MP1-D4 — Draft, Published, and Default remain explicit

Preview source must be visible.

Recommended preview source selector:

- **المسودة / Draft**
- **المنشور / Published**
- **الافتراضي / Default**

Do not let Draft Preview imply publish.

Do not replace Published Experience as a side effect of preview.

**Decision:** ACCEPTED.

---

### Decision MP1-D5 — Full preview mode

Following the proven editor pattern seen in Shopify, AWJ should allow the merchant to hide editing panels and view the application at maximum available size.

Recommended action:
- **معاينة بملء الشاشة / Full preview**

Returning exits preview-only mode and restores the exact editor state.

**Decision:** ACCEPTED.

---

### Decision MP1-D6 — Browser preview may evolve to Flutter Web, but must stay honestly labeled

Flutter Web is technically viable enough to investigate because:
- Flutter officially supports web;
- Flutter can be embedded;
- the same Dart/runtime code may be reusable.

However, this evidence pass does **not** decide that AWJ must use Flutter Web.

MOBILE-PREVIEW-2 must establish:
- how much current mobile runtime code is web-compatible;
- whether commerce client/auth/storage dependencies are web-safe;
- whether current runtime registry/components compile to web;
- whether using Flutter Web would reduce or increase drift;
- whether bundle/startup cost is acceptable.

Until then:
**Browser Preview ≠ native-device proof.**

**Decision:** INVESTIGATE IN MP-2.

---

### Decision MP1-D7 — “Open on phone” uses HTTPS deep-link architecture

The preferred product flow is:

1. Merchant clicks **معاينة على الجوال / Preview on phone**.
2. AWJ issues a short-lived preview session.
3. UI shows a QR code and copyable HTTPS URL.
4. Installed AWJ Preview/runtime app opens using:
   - iOS Universal Links;
   - Android App Links.
5. If no app is installed, the URL lands on a safe browser page explaining the next step.
6. Preview session is validated server-side before draft/runtime content is exposed.

No sensitive data is encoded directly in QR payload beyond an opaque session reference/token.

**Decision:** ACCEPTED AS TARGET; SECURITY CONTRACT DEFERRED TO MP-5.

---

### Decision MP1-D8 — Preview sessions must expire

Shopify’s expiring preview-link pattern supports the UX value of temporary access.

AWJ should use much shorter lifetime by default for runtime/device preview because it can expose unpublished tenant-specific application state.

Exact TTL is **not decided here**.

MP-5 must define:
- TTL;
- refresh/regenerate;
- revoke;
- replay;
- audit;
- binding to tenant/app/revision/device where appropriate.

**Decision:** ACCEPTED PRINCIPLE; DETAILS DEFERRED.

---

## 5. Proposed desktop UX

### Builder top-level structure

Recommended toolbar model:

`[ تصميم ] [ معاينة التطبيق ]     [ المسودة ▼ ] [ AR ] [ iPhone / Android ]     [ معاينة بملء الشاشة ] [ معاينة على الجوال ]`

When **Design** is selected:
- current Builder panels remain;
- Canvas stays selectable/editable.

When **App Preview** is selected:
- editing affordances disappear;
- preview is centered;
- navigation/taps behave as user interactions;
- preview source remains visible;
- truth badge remains visible;
- “Preview on phone” is available when that capability is implemented.

### Preview status strip

Recommended compact status:

`معاينة المتصفح · المسودة · بيانات تجريبية`

or, in future:

`معاينة التشغيل · المسودة · جلسة حقيقية`

This avoids a merchant mistaking sample data for live commerce data.

---

## 6. Proposed physical-device UX

When the user chooses **Preview on phone**:

Modal/sheet:

**معاينة التطبيق على جوالك**

- QR code
- **فتح الرابط**
- **نسخ الرابط**
- Source: Draft / Published
- Expiration
- **إنشاء رابط جديد**
- **إلغاء الجلسة**

Secondary note:
“يفتح هذا الرابط معاينة مؤقتة فقط ولا ينشر التطبيق.”

If physical runtime app is unavailable:
- do not pretend the browser fallback is native;
- show exact state:
  **تطبيق المعاينة غير مثبت — افتح معاينة المتصفح أو ثبّت تطبيق المعاينة عندما يصبح متاحًا.**

---

## 7. States the UX must design before implementation

MP-3 must include UI for:

1. Preview loading
2. Draft unavailable
3. No Published Experience
4. Default Experience
5. Browser preview limitation
6. Unsupported runtime capability
7. Incompatible schema
8. Sample-data mode
9. Live-data mode
10. Preview session expired
11. Preview session revoked
12. Wrong tenant/app/session
13. Device app not installed
14. Network unavailable
15. Runtime temporarily unavailable

No blank phone frame is acceptable as an error state.

---

## 8. What AWJ should explicitly reject

### Reject R1 — “Phone frame = real app”
A CSS phone mockup is not evidence of native behavior.

### Reject R2 — hidden token forwarding
Do not put a long-lived store-bearer token or merchant admin token into browser JavaScript or QR payload merely to make preview data live.

### Reject R3 — preview that silently publishes
Draft preview must never mutate Published Experience.

### Reject R4 — permanent preview links
Unpublished app state must not be exposed through indefinite public URLs.

### Reject R5 — second runtime truth
Do not maintain one behavior in React Preview and another unrelated behavior in Flutter.

### Reject R6 — fake unsupported behavior
If native-only functionality cannot be represented in browser mode, label it unavailable/limited rather than simulating success.

### Reject R7 — app-store workflow inside this Horizon
Preview is not signing, TestFlight, Play distribution, App Store submission, or Production release.

---

## 9. Open questions for MOBILE-PREVIEW-2

These are evidence questions, not permission gates yet:

1. Can the existing `mobile/` runtime compile for Flutter Web with limited changes?
2. Which current packages/plugins are incompatible with web?
3. Can the actual component registry and CompatibilityResolver run unchanged on web?
4. Can Flutter Web be embedded cleanly in the Next.js Builder shell?
5. What is the startup/bundle cost for embedded preview?
6. Does current navigation support preview deep-link context safely?
7. What auth assumptions exist in the current mobile Commerce client?
8. Which data/storage abstractions assume a native secure store?
9. Can a preview source be injected without changing the public App Schema?
10. Can Browser Preview use a preview-session contract later without duplicating the physical-device path?

If evidence shows Flutter Web would create excessive divergence or architectural coupling, AWJ can retain the React browser preview and reserve Flutter for Runtime/Device Preview.

---

## 10. Decision Gate status

**No implementation Decision Gate is triggered by MP-1.**

This task only establishes UX/product direction.

The mandatory security/auth Decision Gate remains at **MOBILE-PREVIEW-5** before preview-session/token implementation.

Potential future gate topics:
- preview credential issuance;
- tenant/app/revision binding;
- data-access authorization;
- merchant/admin vs storefront trust boundary;
- revocation/replay;
- public vs authenticated preview;
- cross-tenant negative behavior.

---

## 11. Recommended next task

Proceed to:

**MOBILE-PREVIEW-2 — Current runtime/preview architecture evidence**

Scope it narrowly around:
- Builder PreviewState and Canvas;
- current Flutter runtime boot;
- runtime registry/rendering;
- CompatibilityResolver;
- commerce experience fetch;
- auth/storage/network assumptions;
- Flutter Web compatibility;
- current integrated test harness.

Do **not** implement preview UI yet.

The output of MP-2 should decide whether Browser App Preview should be:
- React contract renderer,
- embedded Flutter Web,
- or a hybrid shell with one canonical semantic contract.

---

## 12. MP-1 exit result

MOBILE-PREVIEW-1 is considered **PASS** when this evidence document is reviewed and merged.

What this pass establishes:

- Salla validates the product need for a distinct app-preview experience.
- Shopify validates explicit edit/preview/draft/share separation and expiring preview concepts.
- Flutter validates that browser embedding of Flutter is technically possible, but not equivalent to native-device proof.
- Apple and Android validate HTTPS deep-link architecture as the right direction for future “Open on phone”.
- AWJ’s intended UX is now explicitly:
  `Design → Browser App Preview → Real Runtime Preview → Physical Device Preview`
- The next task is architecture evidence, not coding.
