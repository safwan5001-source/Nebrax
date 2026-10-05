# AWJ Store Customizer — Horizon Roadmap V1

**Status:** Product / UX / Architecture plan — implementation not authorized by this document alone  
**Date:** 2026-09-26  
**Repository:** `safwan5001-source/Nebrax`  
**Baseline:** `main@c1bdac3b3f1f7f5be7cfde6b918671d0cb7814e1`  
**Primary UX authority:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_UX_V2.md`  
**Persistence authority:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md`  
**Design authority:** AWJ Design System + storefront responsive/design-system documents  
**Execution method:** **Horizon system** — evidence-first, one coherent capability horizon at a time, with explicit closure gates
**Revision 2026-10-05:** inserted **CUST-HV — Visual Design, Media & Merchant UX Completion** between CUST-H4 (CLOSED) and CUST-H5 (Owner decision, Option A; evidence: `AWJ_STORE_CUSTOMIZER_VISUAL_UX_COMPLETION_MASTER_GAP.md`, contracts: `CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md`). H5/H6 are **not renumbered**.

---

## 1. Why this document exists

The original Customizer UX V2 document correctly established AWJ's direction: a preview-first visual editor, structured sections, click-to-edit, independent scroll surfaces, mobile bottom-sheet editing, merchant-language controls over internal Theme Tokens, and a Draft → Preview → Publish lifecycle.

Since that document was written, the repository has moved forward materially. The following are no longer merely target ideas:

- section-instance identity with `{ id, type, visible }`;
- deterministic migration from the legacy section shape;
- Section Picker;
- add / reorder / hide-show / duplicate / delete capability rules;
- exact section selection by instance id;
- Canvas ↔ section-list selection synchronization;
- standalone Visual Builder workspace;
- Desktop / Tablet / Mobile preview modes;
- preview-first mobile editor with Bottom Sheet;
- Draft / Save / Preview / Publish lifecycle wiring.

Therefore this roadmap **does not restart the Customizer** and does not re-open V2-1, V2-2 or CONTRACT-2. It defines the next product horizons required to take AWJ from a strong visual-builder foundation to a mature merchant customization platform.

The benchmark is Salla's current customization platform, reviewed from first-party Salla Help Center and Twilight documentation on 2026-09-26. Salla is used as **external evidence and a functional benchmark**, not as a design source to copy.

---

## 2. External benchmark — what Salla currently proves

### 2.1 Multi-page theme customization

Salla's current Theme Editor documentation explicitly includes customization surfaces for:

- Home page;
- Product details page;
- Category pages;
- Informational/content pages;
- Header and Footer.

Source:
- https://help.salla.sa/article/%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D9%88%D8%AA%D8%AE%D8%B5%D9%8A%D8%B5-%D8%AA%D8%B5%D9%85%D9%8A%D9%85-%D8%A7%D9%84%D8%AB%D9%8A%D9%85/q793mmwb0n5x33ol7r3h9cjo
- https://help.salla.sa/article/%D8%AA%D8%AE%D8%B5%D9%8A%D8%B5-%D8%B9%D9%86%D8%A7%D8%B5%D8%B1-%D8%B5%D9%81%D8%AD%D8%A9-%D8%B9%D9%86%D8%A7%D8%B5%D8%B1-%D8%A7%D9%84%D8%AB%D9%8A%D9%85/d5almi1jbg1h8365chaq8lt3

**AWJ interpretation:** Multi-page customization is a mature-market expectation. AWJ should reach it through the existing structured section/capability model, not through arbitrary page HTML.

### 2.2 Rich Home-page section library

Salla's current Home-page documentation shows a broad collection of merchant-addable elements, including products, categories and richer media/content sections. The platform presents these as reusable theme elements rather than unrestricted free-form layout.

Source:
- https://help.salla.sa/article/%D8%AA%D8%AE%D8%B5%D9%8A%D8%B5-%D8%B9%D9%86%D8%A7%D8%B5%D8%B1-%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9-%D8%A7%D9%84%D8%B1%D8%A6%D9%8A%D8%B3%D9%8A%D8%A9-%D8%B9%D9%86%D8%A7%D8%B5%D8%B1-%D8%A7%D9%84%D8%AB%D9%8A%D9%85/il0lc8ytqke84u8lj2dezg5n

**AWJ interpretation:** AWJ's Section Registry + Instance Model is the correct foundation, but the merchant-visible library must become much broader and more task-oriented.

### 2.3 Store identity

Salla provides a dedicated identity flow for merchant-facing data and visual identity, including:

- store name and description;
- logo;
- browser favicon;
- store color;
- font selection;
- custom font upload.

Source:
- https://help.salla.sa/article/%D8%AA%D8%AE%D8%B5%D9%8A%D8%B5-%D9%87%D9%88%D9%8A%D8%A9-%D8%A7%D9%84%D9%85%D8%AA%D8%AC%D8%B1/xqtm6xx4ed1knb0lm9tbygb5

**AWJ interpretation:** AWJ should expose a merchant-friendly **Identity Studio**, while Theme Tokens remain internal implementation detail.

### 2.4 Theme copies, states and scheduled publishing

Salla supports multiple theme copies and a lifecycle that includes:

- creating copies;
- renaming;
- customizing;
- previewing;
- publishing;
- scheduled publishing;
- publication targeting;
- editing/canceling publication;
- deleting non-published copies.

It also exposes states such as Draft, Scheduled and Published.

Sources:
- https://help.salla.sa/article/%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D8%AB%D9%8A%D9%85%D8%A7%D8%AA-%D9%88%D8%AA%D8%AE%D8%B5%D9%8A%D8%B5%D9%87%D8%A7-%D9%88%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D9%85%D8%AD%D8%AA%D9%88%D9%89-%D8%A7%D9%84%D9%85%D8%AA%D8%AC%D8%B1/noq1evfqv961rl0kmv3f2lek
- https://help.salla.sa/article/%D9%85%D8%AA%D8%AC%D8%B1-%D8%A7%D9%84%D8%AB%D9%8A%D9%85%D8%A7%D8%AA/rddasl45j3g2nlj4xekoj0sp

**AWJ interpretation:** this is the largest functional maturity gap after the current Visual Builder. AWJ needs a safe version/copy lifecycle rather than mutating one forever-growing draft.

### 2.5 Extensible component platform

Salla Twilight supports reusable components and allows theme developers to define their own components and schemas.

Sources:
- https://docs.salla.dev/422558m0
- https://docs.salla.dev/422580m0

**AWJ interpretation:** AWJ should continue evolving its Section Registry and typed capability contracts instead of hard-coding a permanent fixed list of sections.

---

## 3. AWJ UX North Star

The merchant should feel:

> **أنا أعدل متجري نفسه، وليس إعدادات تصف المتجر.**

The Customizer remains a **structured visual builder**, not a free-form website editor.

### 3.1 Workspace hierarchy

Desktop / large tablet:

```
┌──────────────────────────────────────────────────────────────────────┐
│ خروج │ الصفحة ▼ │ حالة المسودة │ ↶ ↷ │ Desktop Tablet Mobile │ معاينة │ نشر │
├──────────────┬──────────────────────────────────────┬────────────────┤
│ صفحات/أقسام │                                      │ Inspector      │
│              │           LIVE CANVAS                │                │
│ + إضافة قسم │                                      │ محتوى         │
│              │                                      │ تصميم         │
│              │                                      │ تخطيط         │
│              │                                      │ متقدم         │
└──────────────┴──────────────────────────────────────┴────────────────┘
```

The Canvas is visually dominant. Panels support it; they do not compete with it.

### 3.2 Direct manipulation rule

Whenever the merchant can see a customizable storefront element, the shortest route to editing it is direct selection in the Canvas.

Selection must:

1. resolve the exact element or section instance;
2. visibly highlight it without relying on color only;
3. synchronize the corresponding item in the navigation/section list;
4. open the correct contextual inspector;
5. preserve current Canvas scroll position where possible;
6. be reachable through a keyboard-accessible equivalent.

### 3.3 Inspector model

The Inspector should use a stable merchant-facing hierarchy:

1. **المحتوى**
2. **التصميم**
3. **التخطيط**
4. **متقدم**

Do not expose implementation vocabulary such as token keys, JSON fields, schema identifiers or CSS variable names.

**Progressive disclosure rule:** routine work belongs in Content / Design. Advanced options should be required only for a minority of merchants.

### 3.4 Mobile rule

Mobile is **not** a compressed desktop editor.

Primary surface: Canvas.

Primary bottom actions:

- **الأقسام**
- **+**
- **التصميم**

Context editing opens in a Bottom Sheet with:

- a clear title/context;
- drag handle / close affordance;
- independent scrolling;
- large touch targets;
- sticky Save/Done action only when the interaction actually requires it;
- preservation of Canvas position when closing;
- no horizontal clipping.

### 3.5 Preview modes

Desktop / Tablet / Mobile are simulations of **one responsive design document**, never separate designs by default.

Every configuration change must have one of these behaviors:

- shared across all responsive modes; or
- explicitly responsive through a documented supported control.

There must be no silent per-device divergence.

---

## 4. Non-negotiable AWJ boundaries

1. **AWJ editor chrome is AWJ-owned.** Merchant theme colors/fonts must never restyle toolbar, navigation, inspector, dialogs or sheets.
2. **Canvas is merchant-owned presentation.**
3. **Tenant isolation is mandatory.**
4. **Foreign/missing storefront identifiers fail closed without existence leaks.**
5. **Published storefront reads only published state.**
6. **Draft remains private workspace state.**
7. **Backward compatibility remains mandatory.**
8. **No fake capability.** A visible control must either work end-to-end or be explicitly gated.
9. **No arbitrary custom JS in near-term merchant UX.**
10. **No free-form Webflow-style placement.**
11. **Responsive integrity must be preserved by construction.**
12. **No merge, deploy or production release without owner approval.**

---

## 5. What is already complete and must not be re-built

The following foundation is treated as existing capability unless a focused regression proves otherwise:

- V2 shell and selection foundation;
- CONTRACT-2 section instance shape and legacy migration;
- instance-id selection;
- Section Picker;
- section add;
- reorder;
- hide/show;
- capability-aware duplicate/delete;
- non-deletable protected/singleton rules where applicable;
- standalone Visual Builder;
- Canvas dominance;
- Desktop / Tablet / Mobile preview controls;
- preview-first mobile;
- Bottom Sheet editing;
- Draft / Save / Preview / Publish foundation;
- Theme Token isolation between storefront presentation and editor chrome.

Any new horizon must **reuse these contracts**.

---

# 6. Horizon execution model

AWJ Customizer work from this point forward uses the Horizon system.

A Horizon is a **complete merchant capability across all affected surfaces**, not an arbitrary collection of tickets and not a perpetual epic.

## 6.1 Horizon lifecycle

Every Horizon follows this sequence:

1. **Evidence Pass**
   - current repository evidence;
   - current production/runtime evidence if relevant;
   - first-party external benchmark sources where relevant;
   - exact capabilities and gaps;
   - no broad rediscovery of already-closed work.

2. **UX Contract**
   - merchant journey;
   - Desktop/Tablet/Mobile behavior;
   - RTL/LTR;
   - loading/empty/error/conflict states;
   - accessibility;
   - capability gates;
   - Preview/Published parity requirements.

3. **Architecture / Data Contract**
   - reuse existing contracts first;
   - smallest additive change if needed;
   - tenant/auth/security boundaries;
   - backward compatibility;
   - migrations only when genuinely required.

4. **Implementation**
   - dependency-safe tasks;
   - scope remains within the Horizon;
   - no side refactors;
   - one coherent PR is preferred when the capability is truly integrated; split only where technical dependency or risk makes that safer.

5. **Verification**
   - focused unit/integration tests;
   - storefront + Customizer parity checks;
   - responsive visual QA;
   - RTL and LTR;
   - keyboard/focus/accessibility checks where relevant;
   - build/CI.

6. **Pre-Merge Review**
   - open review findings resolved;
   - exact Base SHA / Head SHA;
   - changed-files review;
   - screenshots for UX work;
   - no hidden scope expansion;
   - **No visual approval = No merge** for visual horizons.

7. **Merge Gate**
   - stop before merge unless explicit owner approval exists.

8. **Post-Merge Review**
   - verify merged main;
   - verify CI;
   - production verification only when deployment is separately approved.

9. **Horizon Closure**
   - closure MD;
   - what is complete;
   - what remains intentionally deferred;
   - risks;
   - next recommended Horizon.

**No new Horizon starts automatically.**

---

## 6.2 Required responsive QA matrix

For meaningful Customizer UX changes, visual QA must cover the affected surfaces at representative widths:

- 390px mobile;
- 430px mobile;
- 768px tablet;
- 1024px tablet/small desktop;
- 1280px desktop;
- 1440px desktop.

At minimum:

- Arabic RTL;
- English LTR for structural mirroring;
- long labels/content;
- inspector overflow;
- section-list overflow;
- Canvas scrolling;
- Bottom Sheet scrolling;
- focus return;
- no clipped Save/Publish/Exit actions.

Not every test must create six screenshots if behavior is provably identical, but the implementation report must state which widths were actually inspected and why.

---

# 7. Customizer Horizon Roadmap

## HORIZON CUST-H0 — Close the current Visual Builder baseline

**Purpose:** finish and close any currently in-flight preview/mobile Customizer work before broadening scope.

This is a closure horizon, not a redesign.

### Scope

- complete the current Mobile Preview work;
- preserve the existing standalone workspace;
- resolve any outstanding responsive/editor-chrome regressions;
- establish a clean post-merge baseline for subsequent Horizons.

### UX closure gate

- no compressed-desktop behavior on mobile;
- no clipped toolbar actions;
- Preview Canvas remains primary;
- Bottom Sheets scroll independently;
- direct Canvas selection remains exact by instance id;
- current position is not lost unnecessarily;
- Desktop/Tablet/Mobile modes remain one responsive document;
- visual QA complete.

### Explicitly excluded

- Theme copies;
- scheduled publish;
- multi-page section contracts;
- new Identity persistence;
- broad Section Library expansion.

**Exit:** Horizon closure report + clean baseline. Only then begin CUST-H1.

---

## HORIZON CUST-H1 — Theme Copies & Safe Publication Lifecycle

**Priority:** Highest post-baseline priority.

### Merchant problem

A merchant must be able to prepare a seasonal or campaign design without disturbing the live store or destroying the previous design.

Examples:

- رمضان;
- العيد;
- اليوم الوطني;
- حملة خصم;
- إعادة تصميم كبيرة.

### UX contract

A new top-level **Design Versions / نسخ التصميم** surface is introduced outside the low-level Inspector.

Each version shows:

- name;
- state;
- last modified;
- scheduled publication time if any;
- current/live marker when applicable.

Initial state vocabulary:

- **مسودة**
- **مجدول**
- **منشور**

Core actions:

- إنشاء نسخة;
- إعادة تسمية;
- فتح في المحرر;
- معاينة;
- نشر;
- جدولة النشر;
- إلغاء/تعديل الجدولة;
- تكرار نسخة;
- حذف eligible non-live version.

### Critical UX safety

- The live version must never be deleted directly.
- Publishing must show exactly **what will become live**.
- Scheduling must display timezone explicitly.
- A stale editor must not silently overwrite a newer version.
- The merchant must always know which version they are editing.
- “Save” and “Publish” must remain semantically different.

### Architecture gate

The current single-head draft/published architecture cannot be silently stretched into version history by UI only. This Horizon **requires an evidence-first architecture decision** before implementation.

No DB/API change is pre-approved by this roadmap.

### Verification

- concurrent/stale edits;
- publish atomicity;
- failed publish leaves previous public version intact;
- schedule timezone correctness;
- tenant isolation;
- public runtime only exposes intended published version;
- backward compatibility for merchants with only the legacy current head.

---

## HORIZON CUST-H2 — Multi-Page Visual Builder

**Purpose:** move the structured visual-editing model beyond Home.

### First target pages

1. **الرئيسية**
2. **صفحة المنتج**
3. **صفحة التصنيف**

Informational/custom pages are a later expansion inside this same architecture after the first three are stable.

### UX contract

The top toolbar's current-page control becomes a true page navigator.

Changing page must:

- change Canvas context;
- load the page-specific section/region model;
- preserve the current design version;
- preserve global identity/theme settings;
- clearly distinguish page-specific settings from global settings.

### Page capability registry

Do not assume every section belongs everywhere.

The registry must answer:

- allowed page types;
- max instances;
- duplicate permission;
- delete permission;
- required data dependency;
- fallback behavior;
- responsive constraints;
- capability state: LIVE / DESIGN_ONLY / GATED / DEFERRED.

### Product page

Examples of structured regions to evaluate:

- media/gallery;
- product identity/title;
- rating;
- price;
- variant/options selector;
- quantity;
- primary purchase CTA;
- stock/availability messaging;
- description;
- specifications;
- related/recommended products;
- trust/shipping/payment information where supported.

Commerce truth remains authoritative. The Customizer changes **presentation/order/layout only**, not product pricing, stock, checkout rules or eligibility.

### Category page

Evaluate:

- category identity/banner;
- description;
- subcategories;
- sorting;
- filters layout;
- product grid/list presentation;
- promotional/content sections where valid.

### UX requirement

Page switching must feel like editing one store, not navigating into separate unrelated settings applications.

---

## HORIZON CUST-H3 — Store Identity Studio

**Purpose:** make brand setup simple, coherent and merchant-language-first.

### Core surfaces

**Identity**
- display name where presentation-authorized;
- logo;
- favicon;
- primary store color;
- secondary/surface choices only when supported by the token model;
- body font;
- heading font.

**Global Components**
- buttons;
- cards;
- image radius;
- density;
- shared header/footer visual choices.

### UX principle

Do not expose a long flat settings form.

Use visual groups with immediate Canvas feedback.

The merchant sees:

- **لون المتجر**
- **الخط الأساسي**
- **خط العناوين**
- **شكل الأزرار**
- **استدارة الصور**

The merchant never sees internal token names.

### Font upload gate

Custom font upload is not assumed. It requires:

- tenant-scoped media/storage contract;
- file-type validation;
- size limits;
- font metadata/weight handling;
- licensing responsibility copy;
- CSP/runtime loading review.

Until that exists, font upload remains gated while curated fonts can remain LIVE.

---

## HORIZON CUST-H4 — Section Library & Section Quality

> **STATUS: CLOSED / COMPLETE — 2026-10-04.**
> Final merged verification SHA: `27a8049c5254794f49031e841d4a2549aab7e4cf` (PR #1226, "qa(store): CUST-H4-8 verification rerun after H4-8b — READY FOR H4 CLOSURE").
> Final verdict: all ten merchant-visible homepage sections (`hero, categories, newArrivals, wholesale, banner, featured, offers, benefits, appPromo, customContent`) are **LIVE**, merchant-addable, backed by real contracts and real data, with verified Canvas ↔ Published parity. Offers closed as a real, bounded Commerce-referencing capability (`storefront_offers` + `StorefrontOfferResolver`, real pricing via the existing `CommercePriceResolver`), not GATED. Canvas product-media blocker B1 (workspace `<img>` tags returning `401`/`ERR_BLOCKED_BY_ORB` against the mobile-only media route) was found during H4-8 integrated QA and resolved in H4-8b (signed workspace media route), then independently re-verified on the real stack in the H4-8 rerun. No H4 blockers remain.
> Evidence: `docs/reports/CUST-H4-CLOSURE-REPORT.md` (full evidence chain, section-by-section final state, Offers architecture, media resolution, tenant isolation, parity, tests).
> Per §14 below, the next roadmap-defined horizon is **CUST-H5 — Undo / Redo, Recovery & Change Confidence**. Starting it requires its own Evidence Pass and is not authorized by this closure note alone.
>
> **Update 2026-10-05:** **H4 remains CLOSED.** By Owner decision the next capability Horizon is **CUST-HV** (below); CUST-H5 follows after CUST-HV.

**Purpose:** turn the current registry into a useful merchant content toolbox.

### Library UX

The Section Picker must support:

- search;
- categories;
- clear thumbnails/previews;
- short descriptions;
- compatibility/gated state;
- “most used” or recent items when evidence supports it.

Recommended library taxonomy:

- **المنتجات**
- **التصنيفات والتنقل**
- **العروض والتسويق**
- **الصور والفيديو**
- **المحتوى**
- **الثقة والخدمات**
- **التطبيق والتواصل**

### Section contract requirement

Every section type must define:

- stable type key;
- instance id;
- typed content;
- typed visual settings;
- defaults;
- validation;
- normalization;
- capabilities;
- responsive rules;
- accessibility requirements;
- preview renderer;
- published renderer;
- parity tests.

### No fake sections

A Section Picker card must not imply functionality when the data contract is missing.

Use capability states honestly.

### UX consistency

Every section editor follows:

- Content;
- Design;
- Layout;
- Advanced.

Avoid inventing a different settings experience for every component.

---

## HORIZON CUST-HV — Visual Design, Media & Merchant UX Completion

> **STATUS: ACTIVE NEXT CAPABILITY HORIZON — V0 (Decisions & Contracts) delivered for Owner review.**
> Inserted by Owner decision (**Option A**, 2026-10-05) between CUST-H4 and CUST-H5. **CUST-H4 remains CLOSED and is not reopened.** CUST-H5 (Undo/Redo & Recovery) follows **after** CUST-HV; CUST-H6 (Advanced Extensibility) remains later. No horizon is renumbered by this insertion.
> **Evidence:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_VISUAL_UX_COMPLETION_MASTER_GAP.md` (Master Gap, PR #1230).
> **Contracts:** `docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md` · **Baseline:** `docs/plans/store/CUST-HV-V0-BASELINE-VISUAL-EVIDENCE-REPORT.md`.
> Starting any slice other than V0 requires its own Evidence Gate and, for merge, explicit Owner approval. Deploy/Production always needs separate approval.

**Purpose:** turn the structurally mature Customizer into a **professional, expressive, highly customizable visual store builder** — *creative freedom inside a safe typed design system* — and complete the merchant workflow around it.

**Two design systems (non-negotiable):** the **editor chrome** follows the AWJ ERP design system (clarity, speed, consistency, balanced density, RTL-first, accessibility, restrained motion); the **merchant storefront** follows the merchant's brand and supports broad creative control. Guardrails prevent invalid contrast, broken responsive layouts, unsafe code, fake commerce capabilities and security problems — they do not restrict colour, backgrounds, layout variants, imagery, typography variation, spacing, borders, shadows or expressive Header/Footer/Banner/Hero styling. Not in scope: Webflow/Figma-style freedom, arbitrary CSS/JS, absolute positioning.

### Scope (summary — contracts in the V0 document)

- **Media:** tenant-scoped Customizer media on the approved R2-backed foundation (storage architecture is CLOSED), picker/library, server-generated WebP variants, bounded image editing (crop · focal · fit · aspect · rotate · reset), optional mobile-image override, safe delete, publish-time validation, reference-gated public reads.
- **Visual system:** merchant palette (incl. a live accent role), two-colour gradients, contrast engine (auto-foreground first; ≥ 4.5:1 normal text; 3:1 only for large text/applicable UI), typography families/scales, buttons, surfaces, separators, bounded overlap and motion.
- **Section Visual Contract:** typed per-section capability groups; absent design ⇒ today's output.
- **Surfaces:** Hero & Banner v2 (per-instance Hero), Header (layouts, transparent/overlay-on-hero, sticky), **Footer as a first-class surface (six layouts)**, nested navigation + icon registry, Announcement bar, Slider, Gallery, richer cards, shared content-block vocabulary.
- **Merchant UX:** Content/Design/Layout inspector (progressive), a real editing surface at 768 px, reachable primary actions at every width, section labels, copy/paste style, reset design, built-in presets, drag reorder, hover action bar, complete-system themes (Preview → Apply summary → **new Draft Version**).
- **Out of scope for HV:** content-page backend, mega menu, custom fonts (represented, deferred), user-saved presets, collage/masonry, Undo/Redo (H5), custom CSS/JS (H6), visitor-facing dark/light switch.

### Slices

| Slice | Name | Depends on |
|---|---|---|
| **V0** | Decisions & Contracts | — |
| **V1A** | Independent Defects (DEF-1 mobile custom links · DEF-3a/9/10 stale docs · DEF-4 honest theme Preview) | none (may start immediately) |
| **V1B** | Contract-dependent UX Defects (accent role · 768 editing surface · toolbar overflow/primary actions · delete-confirmation rule) | V0; co-designed with V5 |
| **V2** | Customizer Media Foundation | V0 |
| **V3** | Announcement Bar | V0 |
| **V4** | Media Picker / Image Editor / Logos | V2 |
| **V5** | Section Visual Contract / Inspector / Colour | V0 |
| **V6** | Hero & Banner v2 | V2, V4, V5 |
| **V7** | Header / Footer / Navigation | V5 (V6 for overlay-on-hero) |
| **V8** | Slider / Gallery / Motion | V2, V4, V5 |
| **V9** | Cards / Product & Category Presentation / Content Blocks | V4, V5 |
| **V10** | Theme Gallery / Editing Workflow Polish | V5-V9 |
| **V11** | Verification & Closure | all |

### Horizon-specific gates

- Every slice begins with the **Implementation Evidence Gate** (current Salla + Daftra official docs: adopt / change / reject, with reasons).
- Rollout order for contract changes: **PHP normalizer → storefront renderer → web builder**; additive optional keys only; golden fixtures prove "absent design ⇒ identical output".
- Every visual control has Canvas ↔ saved Draft ↔ Published parity tests.
- Tenant isolation, RBAC (`commerce.manage`), host-resolved Published runtime, Draft/Published separation, Version semantics, revision concurrency, fail-closed normalisation, safe URLs and **commerce truth** may not be weakened.
- Production R2 configuration is an **operational go-live prerequisite**, not a design decision.
- Closure requires the Master Gap §36 Definition of Done (six widths × AR/EN, keyboard + screen-reader pass, reduced-motion, contrast, LCP/CLS budgets, commerce-firewall tests).

**Exit:** Horizon Closure Report. Only then does CUST-H5 start.

---

## HORIZON CUST-H5 — Undo / Redo, Recovery & Change Confidence

> **Sequencing note (2026-10-05):** CUST-H5 follows **CUST-HV**. The HV contract keeps the presentation document plain immutable JSON with media referenced by id so Undo/Redo and version Restore remain cheap; Restore re-validates media references. H5 is **not renumbered**.

**Purpose:** make experimentation safe.

### UX contract

Toolbar:

- Undo;
- Redo;
- saved/unsaved state;
- conflict/stale state when applicable.

Rules:

- undo is scoped to the active draft/version;
- structural operations and settings changes participate consistently;
- Save/Publish boundaries are explicit;
- closing/reloading with unsaved changes has a deliberate policy;
- network failure cannot masquerade as a successful save.

### Recovery

Evaluate:

- local ephemeral operation history;
- server revision history;
- explicit Restore from a saved version.

Do not conflate these concepts.

---

## HORIZON CUST-H6 — Advanced Extensibility

**Purpose:** extend power without compromising SaaS safety.

### Phase A — safer extensions

Evaluate first:

- advanced spacing/layout controls;
- constrained custom CSS;
- section developer SDK/registry;
- theme package/library.

### Custom CSS

If introduced:

- scope it to the storefront;
- sanitize/validate where possible;
- prevent editor-chrome leakage;
- preserve CSP strategy;
- provide reset/recovery;
- clearly label it Advanced.

### Custom JavaScript

**Not part of the initial Advanced Horizon by default.**

It requires a dedicated security architecture review for:

- CSP;
- sandboxing/isolation;
- data exfiltration risk;
- DOM manipulation boundaries;
- checkout/payment surfaces;
- tenant safety;
- support/recovery burden.

Salla's existence of custom code support is benchmark evidence, not automatic authorization for AWJ.

---

# 8. UX detail requirements across all Horizons

## 8.1 States

Every meaningful editor surface must have explicit:

- loading;
- empty;
- saving;
- saved;
- validation error;
- network error;
- stale/conflict;
- capability-gated;
- publish in progress;
- publish failed;
- publish succeeded

states where relevant.

No silent failure.

## 8.2 Selection

Selected state must use more than color:

- outline/border;
- marker/icon;
- accessible `aria-selected` / equivalent;
- synchronized list state.

## 8.3 Reorder

Drag-and-drop may be added, but it cannot be the only accessible reorder mechanism.

Keyboard/button alternatives remain available.

## 8.4 Destructive actions

Delete/reset must:

- name the target;
- distinguish Hide from Delete;
- avoid generic ambiguous confirmations;
- prevent deletion when a capability invariant requires the item.

## 8.5 Save behavior

Do not save every keystroke blindly if it causes server churn or ambiguity.

The implementation Horizon must define the persistence behavior explicitly:

- local draft state;
- debounced persistence where appropriate;
- manual Save where appropriate;
- saved status feedback;
- conflict handling.

## 8.6 Publish behavior

Publish is a high-trust action.

Before publication, the merchant should be able to understand:

- which version/draft is being published;
- whether it replaces the current live design;
- whether publication is immediate or scheduled;
- which audience/market/language is targeted if targeting exists.

---

# 9. Cross-surface parity rule

A Customizer change is not complete merely because the editor UI works.

For every presentation capability, verify:

```
Customizer Draft Preview
        ↓
Normalized Presentation Contract
        ↓
Published Snapshot
        ↓
Public Storefront Renderer
```

The draft preview and published storefront do not need identical transport paths, but they must implement the same presentation meaning.

Parity tests are required for new structural contracts.

---

# 10. Capability and truth matrix

Every planned feature must be classified before implementation:

| State | Meaning |
|---|---|
| **LIVE** | works end-to-end and may be merchant-enabled |
| **DESIGN_ONLY** | UX/presentation exists, production activation intentionally unavailable |
| **GATED** | dependency is known and blocks activation |
| **DEFERRED** | explicitly outside the active Horizon |

A missing backend or trusted data source must never be hidden behind a fake working toggle.

---

# 11. Security and tenant verification checklist

Any Horizon that touches persistence, versions, media, publishing or public output must include tests for:

- tenant A cannot read tenant B drafts;
- tenant A cannot mutate tenant B presentation/version;
- unknown/foreign IDs fail with the established non-leaking behavior;
- public runtime never returns private drafts;
- publishing validates/normalizes server-side;
- media URLs remain tenant-safe;
- external URLs are sanitized;
- custom merchant presentation cannot inject unsafe script;
- rollback/failure preserves last valid published state.

---

# 12. Performance budget

The Customizer is a daily merchant tool. Richer editing must not turn it into a slow design application.

Each Horizon must watch:

- initial editor load;
- preview rerender cost;
- large page with many section instances;
- media-heavy sections;
- inspector responsiveness;
- mobile Bottom Sheet responsiveness;
- publish/save request count;
- accidental N+1 or repeated API fan-out.

Do not trade basic interaction latency for decorative animation.

---

# 13. What AWJ intentionally does differently from Salla

AWJ should not copy Salla's information architecture or visual style literally.

AWJ decisions:

1. **Direct Canvas editing is first-class.**
2. **Canvas remains dominant.**
3. **Mobile is preview-first.**
4. **Theme Tokens stay hidden from ordinary merchants.**
5. **Structured components preserve responsive integrity.**
6. **Capability honesty is mandatory.**
7. **Tenant/security boundaries are product constraints, not implementation details.**
8. **No custom JavaScript merely for parity.**
9. **One responsive design document is the default mental model.**
10. **The editor uses AWJ's dense, clear, trustworthy work-tool design language rather than storefront decoration.**

---

# 14. Recommended Horizon order

After the in-flight current Customizer/Mobile baseline is formally closed:

1. **CUST-H1 — Theme Copies & Safe Publication Lifecycle** *(closed)*
2. **CUST-H2 — Multi-Page Visual Builder** *(closed)*
3. **CUST-H3 — Store Identity Studio** *(closed)*
4. **CUST-H4 — Section Library & Section Quality** *(CLOSED — not reopened)*
4A. **CUST-HV — Visual Design, Media & Merchant UX Completion** *(active next capability Horizon; inserted by Owner decision, Option A, 2026-10-05; H5/H6 not renumbered)*
5. **CUST-H5 — Undo / Redo, Recovery & Change Confidence** *(after CUST-HV)*
6. **CUST-H6 — Advanced Extensibility** *(later)*

This is a dependency-oriented order, not a rigid calendar.

A Horizon may be re-ordered only after a focused Evidence Pass proves that another dependency should come first. (CUST-HV was inserted on that basis: Undo/Redo and Restore are only cheap and safe once the document schema and media references stop changing — see the Master Gap §31.)

---

# 15. Definition of Done for each Horizon

A Horizon is **not closed** when code is merely written.

It is closed only when all applicable items are complete:

- [ ] Evidence Pass recorded.
- [ ] UX contract finalized.
- [ ] Architecture/data contract decision recorded.
- [ ] Capability states honest.
- [ ] Desktop UX implemented.
- [ ] Mobile UX implemented.
- [ ] RTL verified.
- [ ] LTR verified.
- [ ] Accessibility/focus behavior verified.
- [ ] Preview/Published parity verified.
- [ ] Tenant isolation verified.
- [ ] Backward compatibility verified.
- [ ] Focused tests passed.
- [ ] Broader relevant tests passed.
- [ ] Build passed.
- [ ] CI passed or unrelated failures are precisely evidenced.
- [ ] Visual QA completed for relevant width matrix.
- [ ] Implementation report includes changed files, tests, build/CI, risks, Base SHA, Head SHA and PR.
- [ ] Pre-Merge Review complete.
- [ ] Owner explicitly approves Merge.
- [ ] Post-Merge Review complete.
- [ ] Deployment, when needed, is separately approved.
- [ ] Production verification, when applicable, complete.
- [ ] Horizon Closure report written.

---

# 16. Stop / escalation gates

Stop and report rather than improvise if implementation discovers:

- a required persistence change that conflicts with the locked presentation architecture;
- a tenant-isolation ambiguity;
- a need to expose drafts publicly;
- a breaking public Storefront API change;
- an unplanned migration with material production risk;
- a financial/commerce-rule change;
- a capability whose data source does not exist;
- an unsafe custom-code requirement;
- a UX requirement that would require separate per-device theme documents;
- a conflict between the storefront theme and AWJ editor chrome isolation.

The next action after a Stop Gate is a focused decision/evidence task, not a workaround hidden inside the PR.

---

# 17. Documentation rule

For every future Customizer Horizon:

- update this roadmap only when the product direction changes;
- create a Horizon-specific task/spec;
- create a final Implementation Report;
- create a Closure Report when the Horizon is truly done;
- preserve prior reports as historical evidence;
- do not rewrite history to make old plans look current.

---

## Final decision

AWJ will continue with the current Visual Builder architecture.

The goal is **not Salla parity by imitation**. The goal is to combine:

- Salla-level commercial customization maturity;
- AWJ's stronger direct visual editing direction;
- AWJ's instance-based structured section architecture;
- AWJ's responsive/mobile-first editor behavior;
- AWJ's tenant isolation, capability honesty and backward-compatibility requirements.

The Customizer advances **one closed Horizon at a time**.

---

*Documentation only. This file does not authorize application code changes, database/API changes, merge, deploy or production release.*


# 18. Precise Salla ↔ AWJ Comparison & Completion Matrix

This section is the **single explicit parity/completeness matrix**. It exists to prevent requirements from being scattered across prose or lost between Horizons.

The intent is not literal Salla parity. The matrix answers five questions for every important customization capability:

1. What does Salla prove exists today?
2. What does AWJ actually have today?
3. What is still missing for AWJ to be complete and production-real?
4. Which Horizon owns the gap?
5. What proves the item is truly complete?

> **Rule:** an item is not COMPLETE because a control exists in the editor. It is complete only when its UX, persistence, preview, published runtime, validation, tenant isolation, backward compatibility and responsive behavior are all verified where applicable.

| Capability | Salla evidence / maturity benchmark | AWJ current verified direction/state | What AWJ still needs for a complete real capability | Owner Horizon | Completion proof |
|---|---|---|---|---|---|
| Visual editor workspace | Mature theme editor with preview + controls | Standalone full-screen Visual Builder; Canvas-dominant direction already implemented | Close current mobile/preview regressions and lock baseline | CUST-H0 | Responsive QA + build/CI + visual approval + closure report |
| Direct Canvas selection | Salla exposes editable theme elements through the editor | AWJ exact instance-id Canvas selection is part of current V2 foundation | Preserve and extend to all supported page regions, Header/Footer and future sections | CUST-H0/H2/H4 | Exact target selection tests + keyboard equivalent + highlight + inspector sync |
| Section list | Mature element management | Existing structured section list and selection bridge | Keep scalable as section count/library grows; search/grouping when needed | CUST-H4 | Large-page usability + keyboard + overflow QA |
| Add section | Mature add-element flow | Section Picker exists | Expand real section contracts and merchant-useful library | CUST-H4 | Picker shows only honest capabilities; added section survives save/publish/runtime |
| Reorder | Available theme-element ordering | AWJ reorder exists | Add polished DnD if useful without making DnD the only mechanism | CUST-H4/H5 | Mouse/touch + keyboard/button reorder; persisted order parity |
| Duplicate | Available where element supports it | Capability-aware duplicate exists for supported multi-instance types | Ensure per-instance content is copied correctly once richer content contracts exist | CUST-H4 | Duplicate has unique id + copied content/settings + persistence/runtime parity |
| Hide / Show | Mature | Exists | Preserve across all page types | CUST-H2/H4 | Draft + publish + public runtime parity |
| Delete | Mature | Real v2 deletion semantics exist; not merely hidden | Extend safely to all deletable section/page regions | CUST-H2/H4 | Deleted instance does not resurrect after normalize/reload/publish |
| Singleton/protected sections | Theme-dependent constraints | Capability model already supports singleton/protected behavior | Extend registry consistently | CUST-H4 | Registry tests + no invalid duplicate/delete paths |
| Section instance identity | Platform-internal concept not exposed to merchant | Strong AWJ `{id,type,visible}` instance model | Maintain as canonical foundation for new pages/sections | All structural Horizons | Stable ids across save/reload/publish; legacy migration tests |
| Homepage customization | Mature and broad | Most mature AWJ page today | Broaden library and finish content contracts | CUST-H4 | Full supported library parity between editor preview and public runtime |
| Product page customization | Supported in Salla Theme Editor | AWJ concept exists but not yet equivalent to Home visual-builder maturity | Create true product-page region/section contract and editor UX | CUST-H2 | Product page selected in page switcher; real PDP data; presentation-only changes; public parity |
| Category page customization | Supported | Not yet at Home maturity | Structured category layout/regions, filters/sort presentation boundaries | CUST-H2 | Category page draft preview + published parity + no commerce-rule mutation |
| Informational/content pages | Supported | Not yet a mature visual-builder surface | Page model after Product/Category foundation is stable | CUST-H2 later slice | Real page data source + editor + published route parity |
| Header customization | Mature theme region | AWJ has presentation/header settings but not yet full direct region editing maturity | Canvas-selectable Header with contextual inspector and safe global scope | CUST-H2/H3 | Header click-to-edit + global scope clarity + runtime parity |
| Footer customization | Mature theme region | Footer presentation exists | Canvas-selectable Footer + structured groups/settings | CUST-H2/H3 | Same as Header |
| Store identity | Dedicated Salla identity controls | AWJ presentation/identity foundations exist | Consolidated merchant-friendly Identity Studio | CUST-H3 | Logo/favicon/colors/fonts are real, validated, previewed and published |
| Logo | Supported | Storefront presentation supports branding logo paths/data constraints | Replace temporary/design-only media limitations with production-safe tenant media when required | CUST-H3 | Upload/select/store/render securely, tenant isolated, fallback tested |
| Favicon | Supported | Direction documented; maturity lower | Real media pipeline + browser runtime behavior | CUST-H3 | Correct browser icon publication + cache/update behavior |
| Primary colors | Supported | Strong Theme Token architecture exists | Better merchant-facing controls and contrast/invalid-state UX | CUST-H3 | Token mapping + validation + preview/runtime parity |
| Typography | Salla offers fonts and custom font support | AWJ token/preset direction exists | Curated font UX first; custom font only with real media/CSP/licensing handling | CUST-H3 | Font load correctness, Arabic/English coverage, fallback, performance |
| Custom font upload | Supported by Salla | Not production-real in AWJ | Tenant media contract, validation, weights, format policy, CSP, licensing copy | CUST-H3 gated | Security/performance tests + actual public load |
| Buttons/global component style | Theme-level customization | Theme Tokens can support it | Merchant-language Global Design controls | CUST-H3 | Shared component style affects supported storefront components consistently |
| Product card style | Theme-dependent/global design | Existing presentation presets exist | Consolidate into Global Design with real preview examples | CUST-H3 | Listing/search/recommendation card parity |
| Radius/density | Supported through theme settings | Existing tokens/presets | Present clearly; keep advanced details hidden | CUST-H3 | Responsive QA + token parity |
| Desktop preview | Standard maturity | Exists | Keep exact responsive-document semantics | CUST-H0+ | Visual QA |
| Tablet preview | Benchmark maturity varies by theme editor | Explicit AWJ mode exists | Ensure true viewport simulation and no fake tablet-specific document | CUST-H0+ | 768/1024 QA |
| Mobile preview | Standard maturity | AWJ preview-first mobile is a deliberate strength | Close current MOBILE-PREVIEW work; retain Bottom Sheet editing | CUST-H0 | 390/430 QA + real editing from phone |
| Mobile editing | Supported in mature platforms | AWJ direction intentionally preview-first | Ensure every primary merchant task is possible without desktop-only escape | All UX Horizons | Mobile acceptance criteria per Horizon |
| Independent scroll regions | Mature editor expectation | Explicit AWJ requirement; scroll attributes already exist | Prevent regressions as inspector/library grows | CUST-H0+ | Canvas/sidebar/inspector/sheet overflow QA |
| Draft editing | Mature | AWJ Draft→Save→Preview→Publish foundation exists | Preserve as core invariant | All | Public never reads draft |
| Save state | Mature | Exists conceptually/implementation foundation | Consistent Saving/Saved/Error/Conflict states | CUST-H5 | Failure injection + stale write tests |
| Preview | Mature | In-workspace draft Canvas exists | Version-aware preview once copies exist | CUST-H1 | Preview identifies exact version/draft |
| Publish | Mature | Existing publish lifecycle foundation | Make version-aware and high-trust | CUST-H1 | Atomic publish + failed publish retains old live version |
| Theme/design copies | Strong Salla capability | Missing as complete AWJ merchant capability | Multiple named design versions/copies | CUST-H1 | Create/rename/duplicate/open/delete eligible copy end-to-end |
| Draft/Scheduled/Published states | Mature in Salla | AWJ currently has draft/published foundation, not full copy lifecycle | Explicit version state machine | CUST-H1 | Server-enforced transitions + UI state truth |
| Scheduled publishing | Supported | Missing | Schedule, edit, cancel; timezone-visible | CUST-H1 | Scheduler correctness + timezone tests + no accidental early publish |
| Seasonal/campaign designs | Enabled by theme copies/scheduling | Missing as product workflow | Reusable workflow based on versions | CUST-H1 | Merchant can prepare future campaign without touching live store |
| Version history | Salla copies provide lifecycle maturity; exact semantics differ | Explicitly deferred in AWJ | Decide saved versions/history separate from Undo | CUST-H1/H5 | Restore target is explicit and safe |
| Restore | Mature-platform expectation | Deferred | Restore a previous saved/published version without corrupting current work | CUST-H5 or extension of H1 | Restore creates safe state + public remains stable until publish |
| Undo | Editor expectation | Not complete | Operation history for current editing session/draft | CUST-H5 | Structural + field edit undo |
| Redo | Editor expectation | Not complete | Symmetric redo behavior | CUST-H5 | Redo test matrix |
| Unsaved-change recovery | Mature editor expectation | Needs explicit policy | Reload/close/network-loss recovery | CUST-H5 | Browser reload/navigation failure scenarios |
| Stale/concurrent edit protection | Required for safe SaaS editing | Needs explicit complete UX | Optimistic concurrency/conflict UX tied to versions/revisions | CUST-H1/H5 | Two-session conflict tests |
| Section library breadth | Salla has a wide element ecosystem | AWJ registry exists but library is narrower | Broader production-real section catalogue | CUST-H4 | Each section has data contract, editor, preview, runtime and tests |
| Picker search | Useful at scale | Prototype direction supports it; not the maturity target yet | Implement once library size justifies it | CUST-H4 | Search usability/keyboard QA |
| Picker categories | Salla groups capabilities/theme components | AWJ proposed taxonomy documented | Real taxonomy based on section set | CUST-H4 | Clear categories + no dead entries |
| Section thumbnails | Mature discovery UX | Not fully mature | Small trustworthy previews/examples | CUST-H4 | Accurate preview, no misleading content |
| Per-section Content tab | Mature editor pattern | AWJ North Star | Standardize across all section editors | CUST-H4 | Shared inspector conventions |
| Per-section Design tab | Mature editor pattern | AWJ North Star | Standardize supported visual controls | CUST-H4 | No raw token exposure |
| Per-section Layout tab | Mature editor pattern | AWJ North Star | Structured layout choices only | CUST-H4 | Responsive-safe configurations |
| Advanced settings | Mature platforms provide advanced controls | AWJ progressive-disclosure principle exists | Consistent collapsed advanced surface | CUST-H4/H6 | 80% routine workflow does not require Advanced |
| Theme developer components | Salla Twilight supports custom components/schemas | AWJ registry/capabilities foundation points in same direction | Formal internal/developer section SDK/contract | CUST-H6 | New component can be registered without editing core editor logic everywhere |
| Theme library / ready themes | Salla has theme marketplace/copies | AWJ has ready-theme direction and Boutique/Floral work | Formal theme package model and safe install/apply workflow | CUST-H6 or separate Theme Horizon | Theme install/apply preserves store content and compatibility |
| Custom CSS | Salla offers advanced customization | Not approved as live AWJ capability | Scoped/safe custom CSS if business need justifies it | CUST-H6 | Scope isolation + reset + CSP/runtime review |
| Custom JavaScript | Salla supports advanced code in certain contexts | Intentionally not an AWJ parity requirement today | Dedicated security architecture before any implementation | Separate security gate after CUST-H6 | Explicit security approval + sandbox/CSP/exfiltration review |
| RTL-first | Strong regional expectation | Core AWJ requirement | Preserve across every new control/page/version flow | All | Arabic visual + keyboard QA |
| English LTR | Required bilingual support | Existing product principle | Mirror structure without breaking merchant content direction | All | LTR QA |
| Accessibility | Mature-product requirement | Explicit AWJ spec | Enforce focus, keyboard, non-color selection, touch targets | All | Accessibility acceptance checks |
| Tenant isolation | SaaS requirement | Core AWJ architecture principle | Must remain verified for every persisted customization capability | All backend-affecting Horizons | Cross-tenant negative tests |
| Backward compatibility | Mature SaaS requirement | Strong AWJ rule | Old stores/themes must continue to render safely | All structural Horizons | Legacy fixtures + normalization tests |
| Preview ↔ published parity | Mature-platform expectation | Explicit AWJ parity rule | Required for every new section/page/global setting | All | Contract parity tests |
| Merchant capability honesty | AWJ-specific product rule | Strong foundation | Preserve; never surface fake toggles | All | Capability matrix + gating tests |
| Editor/store theme isolation | Strong AWJ architectural rule | Current direction implemented | Preserve under Identity/custom CSS/theme work | CUST-H3/H6 | Merchant styling cannot leak into AWJ editor chrome |

---

# 19. “Complete and Real” Minimum Product Contract

The Store Customizer must **not** be described internally as “complete” until all of the following minimum platform capabilities are production-real:

## 19.1 Editing foundation

- [ ] Direct visual editing remains stable on Desktop/Tablet/Mobile.
- [ ] Canvas selection supports every customizable visible region that AWJ claims is editable.
- [ ] Structured section operations work end-to-end.
- [ ] Mobile can perform real customization, not preview only.
- [ ] RTL and LTR are both verified.

## 19.2 Page coverage

- [ ] Home is fully production-ready.
- [ ] Product page is a true visual customization surface.
- [ ] Category page is a true visual customization surface.
- [ ] Header is directly editable.
- [ ] Footer is directly editable.
- [ ] Informational pages have an explicit status: LIVE or intentionally deferred; they are never implied as complete if not built.

## 19.3 Identity and global design

- [ ] Store logo is production-media-backed.
- [ ] Favicon is production-real.
- [ ] Store colors are validated and accessible enough for supported use.
- [ ] Curated font selection is real.
- [ ] Custom font upload is either production-real or clearly gated.
- [ ] Buttons/cards/radius/density are consistent global controls.

## 19.4 Safe lifecycle

- [ ] Merchant can create more than one design copy/version.
- [ ] Merchant can name and duplicate versions.
- [ ] Merchant always knows which version is being edited.
- [ ] Draft and live remain distinct.
- [ ] Preview shows the intended version.
- [ ] Publish is atomic.
- [ ] Scheduled publish is production-real if presented.
- [ ] Schedule timezone is explicit.
- [ ] Live version cannot be accidentally deleted.
- [ ] Failed publish never corrupts the current live storefront.
- [ ] Concurrent/stale edits have a safe conflict path.

## 19.5 Section ecosystem

- [ ] Section library is broad enough for a real merchant storefront, not merely a demo.
- [ ] Every LIVE section has typed content and visual settings.
- [ ] Every LIVE section has preview + published renderer parity.
- [ ] Every LIVE section has responsive constraints.
- [ ] Every LIVE section has accessibility requirements.
- [ ] GATED/DEFERRED sections cannot masquerade as working.

## 19.6 Confidence and recovery

- [ ] Saving state is explicit.
- [ ] Network failure is explicit.
- [ ] Unsaved work behavior is deliberate.
- [ ] Undo/Redo is production-real or clearly documented as intentionally deferred.
- [ ] A safe restore/version recovery path exists before we call the platform mature.

## 19.7 Security / SaaS truth

- [ ] Drafts are private.
- [ ] Tenant isolation is tested.
- [ ] Foreign IDs do not leak existence.
- [ ] Server re-validates/normalizes all persisted presentation data.
- [ ] Media is tenant-safe.
- [ ] External URLs are sanitized.
- [ ] Merchant presentation cannot inject unsafe script.
- [ ] Backward compatibility is proven with legacy fixtures.

## 19.8 Performance

- [ ] Editor remains responsive with a realistic large page.
- [ ] Preview updates do not trigger pathological rerenders/fetches.
- [ ] Media-heavy sections remain usable on mobile.
- [ ] Save/publish does not create unnecessary request storms.
- [ ] Public storefront performance does not regress materially due to Customizer capabilities.

---

# 20. Explicit gap list that must not be lost

For avoidance of doubt, the following items are **required work or explicit gated decisions** before the Customizer can be considered a fully mature platform:

1. Finish and formally close current MOBILE-PREVIEW / Visual Builder baseline.
2. Theme/design copies.
3. Named version states.
4. Scheduled publication.
5. Safe stale/concurrent editing behavior.
6. Product-page visual builder.
7. Category-page visual builder.
8. Header direct editing.
9. Footer direct editing.
10. Explicit informational-page plan/status.
11. Identity Studio.
12. Production-safe logo/favicon media handling.
13. Curated typography UX.
14. Custom-font decision and, if LIVE, full secure implementation.
15. Global button/card/radius/density controls.
16. Larger real Section Library.
17. Per-section typed content contracts.
18. Per-section Content/Design/Layout/Advanced inspector consistency.
19. Picker search/categories/previews at scale.
20. Preview ↔ Published parity tests for every structural capability.
21. Undo/Redo.
22. Unsaved-change recovery.
23. Version restore/recovery.
24. Responsive QA at representative widths.
25. RTL/LTR verification.
26. Accessibility/focus/keyboard/touch verification.
27. Tenant isolation for every new persisted resource.
28. Backward-compatibility fixtures.
29. Performance checks for large/media-heavy designs.
30. Extensible Section Registry/SDK direction.
31. Ready-theme/theme-package lifecycle.
32. Scoped Custom CSS only after an explicit architecture decision.
33. Custom JavaScript remains blocked until a dedicated security architecture gate approves it.

If an item above is intentionally postponed, its state must be recorded as **DEFERRED** or **GATED**. It must never silently disappear from the roadmap.

**CUST-HV ownership (2026-10-05):** items 8, 9, 12, 13, 14 (decision), 15, 16, 18, 19, 20, 24-26 and 29 are additionally owned by CUST-HV; items 21-23 remain with CUST-H5; 30-33 remain with CUST-H6. Custom-font implementation (item 14) is deferred to late CUST-HV or an immediate follow-up and is represented in the HV architecture.

---

# 21. Product completion language

Use these terms consistently in reports:

- **Foundation complete:** core editor shell/selection/section-instance architecture works.
- **Horizon complete:** one Horizon passed all of its closure gates.
- **Production-real capability:** works end-to-end across UX, persistence, preview/public runtime, security, responsive behavior and tests.
- **Customizer mature:** the minimum contract in §19 is satisfied, or every remaining omission is explicitly approved and recorded as a non-goal.

Do not use “Customizer complete” merely because the main editor screen looks finished.
