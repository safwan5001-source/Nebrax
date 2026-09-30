# AWJ App Builder — Browser Mobile Preview UX Decision

**Status:** Approved UX decision  
**Scope:** App Builder preview experience only  
**Related Horizon:** Real Mobile Preview (MOBILE-PREVIEW-1…9)  
**Approved by owner:** Safwan  
**Base decision context:** MOBILE-PREVIEW-9 closure merged at `931035602e20f47c625970348418496c4e5a855e`

---

## 1. Decision

The AWJ App Builder shall include a **live, interactive mobile-device preview inside the application setup / builder page**.

This preview is not a decorative mockup or a static screenshot. It is the merchant-facing **Browser Mobile Preview** used during normal app design and configuration.

The preview must remain visually and semantically distinct from the real Flutter runtime preview on a physical device.

---

## 2. Required builder layout

The application setup / builder page should present the editing controls and a **mobile device frame** in the same working context.

The mobile frame is the primary in-page preview surface and should remain visible and easy to use while the merchant edits the application.

The exact responsive placement may vary by viewport, but desktop should prefer a side-by-side builder composition rather than forcing the merchant to leave the editing context merely to see the result.

---

## 3. Interactive navigation

The in-page mobile preview must support navigation through **all pages and features that AWJ's supported Browser Preview semantics can truthfully represent**.

Examples include, as capabilities are available:

- Home.
- Categories.
- Product lists.
- Product detail.
- Cart.
- Account/customer surfaces.
- Orders.
- Other supported application routes and components.

Navigation inside the preview should follow the supported AWJ runtime semantics and shared contracts rather than introducing a second, preview-only interpretation.

### Truthfulness rule

A feature that is not supported by Browser Preview must **not** pretend to work.

Unsupported or native-only behavior must surface a clear unavailable/not-supported state instead of fake success.

Examples of behavior that may require Real Runtime / Physical Device Preview include platform-native permissions, push notifications, camera/location integrations, verified App/Universal Links, or other OS-specific behavior.

---

## 4. Preview controls

The preview toolbar shall include two distinct actions:

### 4.1 Refresh Preview — `تحديث المعاينة`

Purpose:

- Refresh/re-synchronize the Browser Mobile Preview.
- Recover from a stale or delayed preview state.
- Re-render the preview from the current supported Draft state according to the builder contract.

Expected UX:

- Clear refresh icon/action.
- Loading state while refresh is in progress.
- Clear success/error feedback where useful.
- The action must not publish the Draft.

Routine/simple edits should update the preview automatically where reliable and safe. Manual refresh remains available as an explicit recovery/control mechanism.

### 4.2 Preview on Phone — `معاينة على الجوال`

Purpose:

- Start the real-device preview handoff.
- Generate/use the approved QR/deep-link flow.
- Open the real Flutter preview runtime rather than the browser approximation.

This action is intentionally different from Refresh Preview.

**Refresh Preview = browser device frame inside the builder.**  
**Preview on Phone = real Flutter runtime on a phone/device.**

---

## 5. Preview truth levels

AWJ keeps the established preview hierarchy:

1. **Design Canvas** — editing surface.
2. **Browser Mobile Preview** — interactive mobile frame inside the builder.
3. **Real Runtime Preview** — actual Flutter runtime.
4. **Physical Device Preview** — Flutter runtime running on a real phone/device.

The UI must not label Browser Mobile Preview as exact native rendering.

---

## 6. Draft / Published behavior

The in-page preview is a preview workflow, not a publishing workflow.

Requirements:

- Preview actions must not mutate Published Experience.
- Draft preview must remain isolated from Published state.
- Refresh must not publish.
- Preview-on-phone must continue using the bounded PreviewSession / exchange architecture already established by MOBILE-PREVIEW-5…9.
- Tenant Isolation, RBAC, auth boundaries, compatibility checks, and backward compatibility remain unchanged.

---

## 7. UX principles

This surface follows AWJ's general product direction:

- Dense, clear, work-oriented UI.
- The preview is a daily working tool, not a decorative showcase.
- Keep the merchant in context while editing.
- Fast feedback matters more than visual spectacle.
- Mobile-frame navigation should be obvious and direct.
- Avoid excessive chrome around the device frame.
- Maintain RTL/LTR and bilingual support.
- Responsive behavior must remain usable on smaller screens.

---

## 8. Salla-style reference direction

The approved product direction is conceptually similar to mature app builders such as Salla where the merchant sees a mobile-shaped preview within the application setup/design workflow.

This is a **reference pattern, not an instruction to copy Salla's private implementation or visual design**.

AWJ keeps its own runtime, security model, contracts, design system, and truth-level separation.

---

## 9. Implementation boundary

This document records an approved UX/product decision only.

It does **not** authorize:

- New mobile build flavors.
- applicationId / bundle-ID changes.
- Native target/scheme redesign.
- DNS or hosting provisioning.
- AASA / assetlinks deployment.
- Signing changes.
- Production deploy or release.

Those remain separately controlled by the MOBILE-PREVIEW operational gates and explicit owner approval.

---

## 10. Acceptance criteria for future implementation/review

A future implementation is aligned with this decision when:

- The application builder visibly contains an interactive mobile-device preview.
- Supported pages can be navigated within the frame.
- Unsupported behavior is represented honestly.
- `تحديث المعاينة` is available as manual refresh/recovery.
- `معاينة على الجوال` remains a separate real-device action.
- Auto-refresh is used where reliable without removing the manual refresh control.
- Draft preview never publishes or mutates Published Experience.
- Browser Preview does not claim native-exact parity.
- Existing PreviewSession, Tenant Isolation, RBAC, compatibility, and production runtime behavior are preserved.
