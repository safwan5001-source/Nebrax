# CUST-H5 — Undo / Redo, Recovery & Change Confidence
## Evidence, Architecture & Execution Plan

**Status:** PROPOSED FOR OWNER REVIEW — documentation only  
**Date:** 2026-10-12  
**Repository:** `safwan5001-source/Nebrax`  
**Base:** `main@d94ecd4e3e74bb54241d76af28895d2f327c4455` (CUST-HV V11 closure)  
**Roadmap authority:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md`  
**Persistence authority:** `docs/plans/store/CUST-H1-ARCH-1-THEME-VERSION-PERSISTENCE-SCHEDULING.md` + CUST-H2 whole-document Version contract  
**Predecessor:** CUST-HV — CLOSED  
**Successor:** CUST-H6 — Advanced Extensibility  
**Scope of this document:** Evidence Pass + UX/architecture contract + dependency-safe execution plan.  
**No application code, migration, API change, merge, deploy or Production release is authorized by this document alone.**

---

## 0. Executive decision

CUST-H5 should make experimentation safe by implementing **three distinct concepts that must never be conflated**:

1. **Local Undo / Redo**
   - ephemeral;
   - browser-session only;
   - scoped to the currently edited Version;
   - operates on unsaved local editor changes;
   - never changes Published state;
   - never bypasses Version revision concurrency.

2. **Saved Revision Recovery**
   - server-side, durable, tenant-scoped snapshots of successfully saved Version documents;
   - bounded retention;
   - read-only history;
   - recovery never rewinds the database revision counter and never mutates Published directly.

3. **Version Restore / Copy**
   - existing Design Version lifecycle remains the product-level recovery mechanism across named designs;
   - Published versions remain immutable;
   - restoring Published/history content must result in an editable Draft path, never an in-place Published rewrite.

The existing **Version-level `revision` remains the sole optimistic-concurrency authority**. CUST-H5 must not introduce per-page, per-section, operation-level or client-authored concurrency tokens.

### Recommended V1 behavior

- Undo/Redo follows the current-session unsaved-change model.
- **Successful Save is a hard Undo/Redo boundary**: once Save succeeds, prior local undo/redo entries are cleared.
- Version switch, successful reload, lifecycle transition to immutable Published, and explicit discard also clear local history.
- Failed Save does **not** clear history.
- A stale 409 does **not** auto-retry, auto-merge, or silently replay operations.
- Durable server history is append-only evidence of successful saves, not an alternate write path.
- Restore from a saved revision loads the chosen historical document into the editor as a **new unsaved local draft state** against the current Version revision; the merchant must explicitly Save.
- If the target Version is Published/immutable, recovery creates or duplicates into a Draft Version rather than mutating Published.

This keeps Undo/Redo fast and predictable while giving real recovery after reload, browser loss, or an accidental Save.

---

# 1. Evidence Pass

## 1.1 Current repository truth

The current Customizer already has strong safety foundations:

- Design Versions are first-class rows.
- Each Version stores the **entire presentation document** in one JSON `config`.
- Each Version has a single integer `revision`.
- Save is a whole-document PUT.
- A stale Version save returns **409** and preserves the winner.
- Version state is derived from authoritative head pointers.
- Published is not a writable editing surface.
- Save and Publish are distinct actions.
- Publish requires a saved/non-dirty Version.
- Public storefront reads Published only.
- Version switching with unsaved changes already requires explicit discard confirmation.
- stale-response guards already protect delayed callbacks during Version switching.
- an edit made while Save is in-flight is preserved locally rather than overwritten by the Save response.
- CUST-HV kept the presentation document plain immutable JSON and moved media to id references, so in-memory history and durable snapshots remain tractable.

### Important persistence constraint

CUST-H2 froze the model as:

> one Version document, one Version revision, no per-page revision.

CUST-H5 must preserve this.

Undo/Redo may affect Home, Product, Category, Header, Footer, global design, media references or any future document path, but the server still saves one complete Version document under one revision.

## 1.2 Current gaps

Today AWJ does **not** provide:

- Undo;
- Redo;
- keyboard Undo/Redo shortcuts owned by the Customizer;
- a visible history boundary;
- durable save history for one Version;
- recovery of a previous successful Save after reload;
- a clear recovery path after an accidental Save;
- conflict recovery that preserves the merchant's local intent beyond the current in-memory session.

Existing Design Versions solve **named design lifecycle**, but they do not by themselves recover an earlier save of the same Draft Version.

## 1.3 External benchmark

### Shopify first-party evidence

Current Shopify Theme Editor documentation explicitly provides:

- Undo and Redo controls;
- keyboard shortcuts;
- Undo/Redo for **unsaved customizations**;
- once changes are saved, those Undo/Redo changes are no longer available.

Source:
- Shopify Help Center — Theme editor features overview:
  `https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/features-overview`

**AWJ interpretation:** use a clear local unsaved-session history with Save as an explicit boundary. This avoids pretending a local undo stack is durable revision history.

### Salla first-party evidence

Salla documents merchant-visible theme copies with Draft / Scheduled / Published lifecycle, duplication, preview, scheduling and deletion rules.

Sources:
- `https://help.salla.sa/article/إدارة-الثيمات-وتخصيصها-وحماية-محتوى-المتجر/noq1evfqv961rl0kmv3f2lek`
- `https://help.salla.sa/article/متجر-الثيمات/rddasl45j3g2nlj4xekoj0sp`

The current reviewed Salla sources establish Version/copy lifecycle but do **not** provide enough first-party evidence here to freeze a specific Undo/Redo algorithm. AWJ therefore uses Shopify only as evidence for the session-history UX boundary and relies on AWJ's own persistence invariants for recovery design.

---

# 2. Product goals

CUST-H5 exists to make merchants confident enough to experiment.

A merchant should be able to answer:

- “Can I undo what I just did?” → **Yes.**
- “Can I redo it?” → **Yes, until a new branch of edits replaces the redo path.**
- “Did Save actually succeed?” → **The UI must say so only after server success.**
- “Can Undo accidentally change the live store?” → **No.**
- “Can I recover yesterday's saved Draft after I changed it?” → **Yes, through saved revision recovery.**
- “Can a stale browser overwrite someone else's newer work?” → **No.**
- “Can the system silently merge two conflicting design documents?” → **No.**
- “Can I restore Published in place?” → **No; Published remains immutable.**

---

# 3. Frozen H5 UX contract

## 3.1 Toolbar

Desktop/tablet toolbar adds:

- Undo;
- Redo;
- existing Save state;
- existing conflict/stale state.

Mobile keeps Canvas-first behavior; Undo/Redo must remain reachable without forcing desktop chrome into the mobile editor.

Required keyboard shortcuts:

- Windows/Linux Undo: `Ctrl+Z`
- macOS Undo: `Cmd+Z`
- Windows/Linux Redo: `Ctrl+Y` and `Ctrl+Shift+Z`
- macOS Redo: `Cmd+Shift+Z`

Shortcuts must not steal native text editing while focus is inside a text input, textarea, contenteditable region, combobox text field or another control whose native Undo/Redo is expected.

## 3.2 Local history scope

History is keyed to the **active Version id** and current browser editing session.

History never crosses:

- Version switch;
- storefront switch;
- logout/auth boundary;
- full reload;
- explicit discard;
- successful Save;
- transition of the active Version into immutable Published state.

No local history entry may contain tenant authority or server identifiers not already present in the active document.

## 3.3 What participates in Undo/Redo

All merchant-visible changes to the presentation document participate consistently, including:

- section add/delete/duplicate/reorder/show/hide;
- section content;
- design/layout controls;
- Header/Footer/navigation edits;
- Theme/global token edits;
- product/category presentation settings;
- media-reference changes;
- bounded crop/focal/transform references;
- gallery/slider/content blocks;
- section names and editor-owned document metadata that persist in the Draft.

Pure editor context does **not** enter document history:

- selected section/block;
- selected page;
- preview product/category;
- viewport simulation;
- open/closed panel state;
- scroll position;
- temporary dialogs;
- loading/error banners.

## 3.4 Operation grouping

Undo must correspond to merchant intent, not every React render.

Examples:

- typing one word/phrase should not require one Undo per keystroke;
- dragging/reordering once is one history step;
- choosing one color is one step;
- replacing one image is one step;
- duplicate/delete/add is one step.

Implementation may use transactions/coalescing internally, but the visible behavior must remain deterministic.

A new merchant edit after Undo clears the Redo branch.

## 3.5 Save boundary

**Successful Save is a hard history boundary for H5 V1.**

On successful Save:

- the returned normalized document becomes the saved baseline;
- the server-returned revision becomes authoritative;
- Undo and Redo stacks clear;
- status becomes Saved only after success.

On failed Save:

- the local draft is preserved;
- Undo/Redo history is preserved;
- Saved status must not be shown.

On a stale 409:

- keep the local draft/history in memory;
- enter explicit conflict state;
- do not auto-retry;
- do not silently overwrite;
- do not silently apply a merge.

## 3.6 Publish boundary

Publish remains governed by the existing rule:

- only a saved/non-dirty eligible Version may publish.

Undo/Redo can never operate on Published state.

If a Draft Version becomes Published:

- local history for that Version is cleared;
- the editor adopts the authoritative lifecycle state;
- further editing follows the existing “create/duplicate Draft” model.

## 3.7 Reload / close behavior

H5 V1 does **not** treat browser storage as persistence authority.

- Existing navigation/unsaved guards remain.
- Full reload/browser loss discards unsaved local history.
- The product must say “Unsaved” honestly.
- H5 must not add silent localStorage/sessionStorage autosave of the presentation document without a separate security/staleness decision.

Durable recovery is provided by **server-saved revision history**, not by pretending browser storage is a reliable database.

---

# 4. Durable saved-revision recovery contract

## 4.1 Why it is needed

Local Undo/Redo cannot recover:

- a closed tab;
- browser crash;
- device switch;
- an accidental successful Save;
- a previous session.

Named Design Versions are larger product copies, not granular history of every successful Save.

Therefore CUST-H5 should add a bounded, tenant-safe history of **successful saved Version documents**.

## 4.2 Recovery record

Recommended additive model:

`storefront_presentation_version_revisions`

Conceptual fields:

- `id`
- `tenant_id`
- `storefront_id`
- `version_id`
- `version_revision`
- `schema_version`
- `config`
- `created_at`

Optional actor metadata may be added only if the repository already has a stable, privacy-safe user attribution convention suitable for this domain; do not invent one just for H5.

### Invariants

- tenant-owned;
- immutable after creation;
- created only from a successfully normalized server document;
- never trusted from client tenant/version ownership;
- one record per durable Version revision;
- retention is bounded;
- history cleanup must never delete the current Version row or any Published snapshot.

Exact retention count/age should be chosen during the implementation evidence gate after measuring worst-case document size and database cost. It must be finite and documented.

## 4.3 Write ordering

A successful Version Save remains one transactional authority.

Recommended ordering inside the existing lock discipline:

1. resolve TenantContext;
2. lock Storefront → presentation head → Version using the established order;
3. validate expected Version revision;
4. normalize incoming whole document;
5. before replacing Version config, record the previous saved state if it is not already represented;
6. write the new normalized Version config;
7. increment revision exactly once;
8. optionally record the new successful revision according to the chosen canonical history convention;
9. commit.

Implementation must choose one canonical convention (pre-save snapshots or post-save snapshots) and prove no gaps/duplicates under retries. The API must not expose ambiguity.

## 4.4 Recovery UX

Recovery history is merchant language, not database language.

Show:

- saved time;
- relative time;
- optional “current” marker;
- Preview;
- Restore.

Do not expose raw revision integers as the primary label.

### Restore to editable Draft

For an editable Draft/Scheduled Version:

1. fetch the selected historical snapshot;
2. revalidate/normalize it server-side or through the same trusted normalization path;
3. revalidate all media references against current tenant ownership/readiness;
4. load it into the editor as **unsaved local draft state**;
5. mark Dirty;
6. require explicit Save;
7. Save uses the **current** Version revision, never the historical revision.

This means Restore never rewinds concurrency.

### Restore from Published / immutable state

Never mutate Published.

Use an existing/new Draft creation flow:

- create Draft from selected snapshot;
- normalize/revalidate;
- give it a new Version id;
- open that Draft.

## 4.5 Media references during recovery

A historical snapshot may reference media that was later deleted or became unavailable.

Restore must:

- re-check tenant ownership;
- re-check current media validity/readiness;
- fail closed or surface actionable missing-media errors;
- never resurrect deleted R2 bytes by id alone;
- never bypass Published-reference or media ownership gates.

The merchant must know which references need replacement before Save/Publish if the contract requires it.

---

# 5. Conflict recovery contract

A stale 409 is a **different concept** from Undo/Redo.

Required behavior:

- preserve the local unsaved document in memory;
- show that a newer server revision exists;
- offer explicit Reload/Review paths;
- never auto-merge;
- never blindly replay local history onto a newer document.

H5 may provide a safe “preserve my work as a new Draft” flow only if the implementation slice proves an API path that:

- validates the complete document;
- creates a tenant-owned new Version;
- does not overwrite the winner;
- clearly communicates that it is a copy, not a merge.

If this cannot be proven without a new architecture decision, defer it rather than adding a fragile client merge.

---

# 6. Architecture boundaries

CUST-H5 must not change:

- Version as unit of work;
- one whole JSON presentation document per Version;
- one Version-level `revision`;
- Storefront/Version tenant lock order;
- Draft vs Published semantics;
- Published immutability;
- Save vs Publish distinction;
- server normalization authority;
- stale 409 semantics;
- scheduled publication generation/token guarantees;
- public Published-only runtime;
- media ownership;
- commerce firewall;
- accounting behavior;
- backward compatibility.

Do not introduce:

- per-page revisions;
- per-section server revisions;
- CRDT/OT collaborative editing;
- automatic three-way merges;
- browser-storage authority for saved state;
- hidden autosave that changes Save semantics;
- local recovery that can overwrite a stale server Version;
- arbitrary mutation logs coupled to UI component internals.

---

# 7. Data / performance evidence gate

Before freezing the durable history implementation, measure:

- current typical presentation document size;
- practical maximum normalized document size;
- cost of storing N revisions per active Version;
- save frequency in realistic merchant sessions;
- PostgreSQL index/table growth;
- cleanup cost;
- JSON compression options only if already supported safely by the stack.

The implementation should prefer correctness and simplicity over premature delta encoding.

Because documents use ids for media rather than embedding binary media, full immutable JSON snapshots are the preferred baseline unless measurement proves them unsuitable.

If full snapshots are too costly at the chosen retention target, STOP and return with measured evidence before introducing patch chains/delta reconstruction.

---

# 8. H5 slice plan

## H5-0 — Evidence & Architecture Lock
**Type:** docs only.

- verify current editor/save/version behavior on latest main;
- measure document-size/recovery-storage envelope;
- freeze retention convention;
- freeze history row canonical semantics;
- freeze restore API shape;
- confirm no conflict with schedule/publish lifecycle;
- record external benchmark evidence;
- no runtime change.

**Exit:** Owner-approved architecture contract.

## H5-1 — Local History Core
**Depends on:** H5-0.

- pure history engine;
- Version-scoped session ownership;
- bounded history;
- grouping/coalescing;
- redo branch invalidation;
- reset boundaries;
- unit/property-style tests over representative documents.

No server/DB changes in this slice.

## H5-2 — Undo/Redo UX & Accessibility
**Depends on:** H5-1.

- toolbar controls;
- mobile reachability;
- keyboard shortcuts;
- native-input shortcut exclusions;
- AR RTL / EN LTR;
- disabled-state semantics;
- screen-reader labels;
- Design Quality Pass;
- real-browser coverage at 390 / 430 / 768 / 1024 / 1280 / 1440.

## H5-3 — Durable Saved Revision History
**Depends on:** H5-0.

- additive migration/model;
- tenant-scoped history API;
- transactional save integration;
- bounded retention;
- concurrency tests on SQLite + PostgreSQL;
- no Published mutation;
- no public endpoint exposure.

## H5-4 — Recovery / Restore UX
**Depends on:** H5-2 + H5-3.

- recovery/history panel;
- preview historical saved state;
- restore into local dirty Draft;
- explicit Save;
- Published → new Draft recovery path;
- missing/deleted media handling;
- mobile/tablet UX;
- no fake success.

## H5-5 — Conflict & Failure Confidence
**Depends on:** H5-2 + H5-3.

- stale 409 preserves local history;
- explicit recovery choices;
- network failure and retry states;
- in-flight save + continued editing;
- version switch/reload/discard boundary tests;
- optional “save as new Draft” only if safely proven.

## H5-6 — Integrated Verification & Closure
**Depends on:** all required prior H5 slices.

Verify as one product:

- Undo/Redo over structural + settings edits;
- Save boundary;
- Version switch boundary;
- Published immutability;
- reload/close policy;
- network failure;
- stale 409;
- durable history tenancy;
- restore with current revision;
- media revalidation;
- schedule/publish interactions;
- AR RTL / EN LTR;
- mobile/tablet/desktop;
- keyboard and focus;
- backward compatibility;
- PostgreSQL concurrency;
- full CI;
- Horizon Closure Report.

Only then close CUST-H5 and proceed to CUST-H6.

---

# 9. Continuous execution model after H5-0 approval

Use the same successful Horizon model as CUST-HV, with **one active H5 slice at a time**.

For each slice:

1. sync latest `origin/main`;
2. inspect only relevant current evidence and overlapping open PRs;
3. implement one dependency-safe slice;
4. run focused tests;
5. run required broader tests/build;
6. perform Design Quality Pass for visual work;
7. open one focused PR;
8. inspect CI/review findings;
9. fix legitimate in-scope findings;
10. produce an MD Implementation Report;
11. merge only under the Owner authorization in force for H5;
12. sync main and continue.

Do not stack unmerged H5 slices.

### Owner authorization — 2026-10-12

Safwan explicitly authorizes **guarded sequential autonomous execution and Squash Merge for CUST-H5 slices H5-1 through H5-6**.

Claude Code may continue without asking between normal implementation steps and may Squash Merge each H5 slice PR automatically **only when all slice gates pass**:

- implementation is complete and within the approved H5 contract;
- focused tests pass;
- required broader tests/build pass;
- CI Gate is green;
- legitimate review findings are resolved;
- Design Quality Pass is complete for visual/interaction changes;
- Tenant Isolation, security, Draft/Published separation, Version-level revision concurrency, media ownership, commerce truth and backward compatibility remain intact;
- the final MD Implementation Report is complete;
- no Mandatory STOP condition in §10 applies.

Required continuous loop:

1. sync latest `origin/main`;
2. inspect only relevant dependencies / overlapping work;
3. implement **one dependency-safe H5 slice**;
4. test and perform UX/design QA where applicable;
5. open **one focused PR**;
6. wait for CI/review and resolve legitimate findings;
7. complete the final MD Implementation Report;
8. if all gates pass, **Squash Merge**;
9. sync latest `main`;
10. immediately continue to the next dependency-safe H5 slice.

Do **not** accumulate multiple unmerged H5 PRs.

Normal implementation problems, test failures, CI failures/timeouts, merge conflicts, reversible UX decisions and ordinary review findings must be solved autonomously and are **not** reasons to stop.

Stop only for the consequential conditions in §10, including architecture/contract changes, security/Tenant Isolation uncertainty, breaking API/DB changes, accounting behavior changes, technically impossible frozen contracts, material cross-Horizon conflicts, new Production infrastructure requirements, or Deploy / Production Release.

**Deploy is NOT authorized. Production Release is NOT authorized. Destructive Production actions are NOT authorized.**

---

# 10. Mandatory STOP conditions

Stop and return to Safwan if any slice discovers:

1. a requirement to change Version-level revision granularity;
2. need for a CRDT/automatic merge architecture;
3. Tenant Isolation uncertainty;
4. a recovery path that can mutate Published in place;
5. a destructive/breaking DB change;
6. breaking public/storefront API change;
7. accounting/financial behavior change;
8. media recovery requiring resurrection of deleted tenant data;
9. full-snapshot history is operationally unsuitable and a delta/patch chain would be required;
10. a new Production infrastructure requirement;
11. conflict with frozen CUST-H1/H2/HV invariants;
12. Deploy or Production release.

Normal test failures, CI failures, reversible UX decisions and ordinary review findings are not STOP conditions.

---

# 11. Definition of Done

CUST-H5 is complete only when:

- local Undo/Redo is available and accessible;
- all document-changing editor operations participate consistently or have an explicit documented exclusion;
- successful Save creates an explicit history boundary;
- Save failure never masquerades as success;
- stale 409 never auto-overwrites or auto-merges;
- durable saved-revision recovery exists with bounded retention;
- recovery is tenant-safe and media-safe;
- restore never rewinds the Version concurrency counter;
- Published is never mutated by Undo/Redo/Restore;
- Version switches and lifecycle boundaries are deterministic;
- AR RTL and EN LTR are verified;
- 390 / 430 / 768 / 1024 / 1280 / 1440 are verified where UI changes apply;
- keyboard/focus behavior is verified;
- SQLite + PostgreSQL concurrency coverage passes;
- backward compatibility passes;
- full CI is green;
- H5 Closure Report records risks/deferred work;
- no Deploy/Production verification is claimed unless separately performed.

---

# 12. Explicitly deferred from H5 V1

Unless implementation evidence forces reconsideration:

- real-time multi-user collaboration;
- operation transforms / CRDT;
- automatic conflict merge;
- cross-device unsaved-session recovery;
- browser localStorage as persistence authority;
- unlimited revision history;
- revision branching/fork visualization;
- Git-like diff UI for presentation JSON;
- restoring deleted media bytes;
- Undo of Publish itself;
- Undo across different Versions;
- global account-level history.

---

# 13. Recommendation

Proceed with **H5-0 only** first.

Do not begin runtime implementation until the Owner reviews these three high-impact decisions:

1. **Save is a hard Undo/Redo boundary.**
2. **Durable recovery uses bounded server-side successful-save snapshots.**
3. **Restore loads history into an editable Draft flow using the current Version revision; it never rewinds revision or mutates Published.**

If approved, Claude Code can execute H5-1 → H5-6 sequentially under the same guarded Horizon discipline used successfully for CUST-HV.

---

**Merge:** NOT PERFORMED  
**Deploy:** NOT PERFORMED  
**Production release:** NOT PERFORMED
