# AWJ V2 — Visual Reference Concepts (preserved from PR #703)

> أرشيف: مقطع §2 من مخطط AWJ_DESIGN_SYSTEM_V2_BLUEPRINT كما كان في PR #703 (2026-09-08). ثُبّت هنا كملف مستقل لأن المخطط الحالي في `main` تغيّر وتعذّر دمج إعادة الترقيم. الصور في هذا المجلد (references/). المحتوى مرجعي ولا يعتمد قراراً تصميمياً.

## 2. Visual Reference Concepts

**AWJ V2 Visual Reference Concepts — 2026-09-06.** Three concept images were produced on 2026-09-06 during V2 direction exploration and are preserved here so future design decisions do not depend on chat history:

1. [`./awj-v2-sales-invoice-desktop.jpeg`](./awj-v2-sales-invoice-desktop.jpeg) — AWJ Sales Invoice Concept — Desktop.
2. [`./awj-v2-product-master-desktop-mobile.jpeg`](./awj-v2-product-master-desktop-mobile.jpeg) — AWJ Product Create / Master Record Concept — Desktop + Mobile.
3. [`./awj-v2-customer-master-desktop-mobile.jpeg`](./awj-v2-customer-master-desktop-mobile.jpeg) — AWJ Customer Create / Master Record Concept — Desktop + Mobile.

These represent the **current visual starting point** for V2 direction — not a production implementation, and not final specifications for every element shown in them.

### 2.1 What these concepts are used for

The concepts are used primarily as a reference for the **main workspace**, specifically:

- Information hierarchy.
- ERP information density.
- Document/form composition.
- Field sizing and grouping.
- Section hierarchy.
- Tabs/sections.
- Contextual page actions.
- Line-item grid prominence.
- Totals and supporting information.
- Master-record composition.
- Desktop/mobile responsive composition.
- Overall clarity and daily ERP usability.

This is the visual direction the team intends to keep studying and evolving. It does **not** mean every pixel, measurement, or control shown is final or approved.

### 2.2 Sidebar — OPEN DESIGN DECISION

**IMPORTANT:** The sidebar / primary navigation shown in the three concept images is **not approved** as the final AWJ V2 design.

None of the following is documented as a final requirement on the basis of appearing in these images:

- Sidebar width.
- Sidebar colors.
- Navigation grouping.
- Navigation labels.
- Icons.
- Active states.
- Spacing.
- Hierarchy.
- Visual treatment.
- Collapse behavior.
- Positioning.

**AWJ V2 Sidebar remains an OPEN DESIGN DECISION.** It will be designed and reviewed independently as part of a future App Shell / Sidebar specification. (Note: §4.1 below records the already-approved *structural* decision that a persistent sidebar is the primary navigation surface and that module navigation must not be duplicated in a top ribbon — that structural decision predates and is independent of these images and remains in force. What is open is the sidebar's visual and interaction design, not whether it exists.)

### 2.3 Global Header / App Shell — not fully approved

The Global Header and App Shell shown in the concept images are likewise **not final specifications**. Appearing in these images does not by itself approve:

- Global search placement.
- User/account placement.
- Notifications placement.
- Theme/language control placement.
- Header height.
- Global action placement.
- Exact shell spacing.
- Desktop shell composition.

These elements will be reviewed as part of a future **AWJ App Shell V2** effort.

The already-approved hierarchy decision in §4 (Primary Navigation / Global Header / Page Header / Contextual Command Bar / Workspace, and no duplicate module navigation) remains in force and is not superseded by these images.

### 2.4 Stitch exploration status

The earlier Stitch invoice-screen exploration referenced throughout this document (see §9) is **exploratory only** and is not a final AWJ V2 design. It is not superseded or replaced by the three concept images above — it is a separate, earlier, non-binding exploration. Lessons already captured from it in §9 remain retained; no new lessons are inferred from it beyond what is already documented there.

### 2.5 Precedence / authority order

To avoid future ambiguity, design authority is ordered as follows, highest first:

1. **Explicit approved decisions in this document** (`AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`).
2. **Future approved AWJ V2 pattern specifications** (e.g. a later-approved Document Workspace Pattern V2 spec, or App Shell V2 spec).
3. **The three AWJ Visual Reference Concepts** (§2 above) as visual-direction references, within the scope defined in §2.1.
4. **Microsoft Dynamics 365** as a structural/ERP UX reference only (see §10).
5. **The Stitch exploration** as non-binding exploratory material (see §9, §2.4).

**If an element visible in a screenshot conflicts with an explicit decision in this Blueprint, the Blueprint wins.** A visual element appearing in a reference image is not, by itself, grounds to infer a new requirement — it must be explicitly promoted to a decision in this document (or a future approved pattern spec) before it is binding.

