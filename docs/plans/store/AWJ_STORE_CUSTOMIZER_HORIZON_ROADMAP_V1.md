# AWJ Store Customizer — Horizon Roadmap V1

**Status:** Product / UX / Architecture plan — implementation not authorized by this document alone  
**Date:** 2026-09-26  
**Repository:** `safwan5001-source/Nebrax`  
**Baseline:** `main@c1bdac3b3f1f7f5be7cfde6b918671d0cb7814e1`  
**Primary UX authority:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_UX_V2.md`  
**Persistence authority:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md`  
**Design authority:** AWJ Design System + storefront responsive/design-system documents  
**Execution method:** **Horizon system** — evidence-first, one coherent capability horizon at a time, with explicit closure gates

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

## HORIZON CUST-H5 — Undo / Redo, Recovery & Change Confidence

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

1. **CUST-H1 — Theme Copies & Safe Publication Lifecycle**
2. **CUST-H2 — Multi-Page Visual Builder**
3. **CUST-H3 — Store Identity Studio**
4. **CUST-H4 — Section Library & Section Quality**
5. **CUST-H5 — Undo / Redo, Recovery & Change Confidence**
6. **CUST-H6 — Advanced Extensibility**

This is a dependency-oriented order, not a rigid calendar.

A Horizon may be re-ordered only after a focused Evidence Pass proves that another dependency should come first.

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
