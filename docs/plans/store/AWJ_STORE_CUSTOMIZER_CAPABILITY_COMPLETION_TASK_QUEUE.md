# AWJ Store Customizer Capability Completion — Task Queue

**Horizon:** `AWJ_STORE_CUSTOMIZER_CAPABILITY_COMPLETION_HORIZON.md`  
**Base at creation:** `1a0cac9863e48eb4eb2e4870e1f0aa70878382af`

This queue is a dependency map, not permission to skip the Evidence Pass. The executor may refine task boundaries after evidence, but must keep scope small and dependency-safe.

| Order | ID | Outcome | Initial dependency | State |
|---|---|---|---|---|
| 0 | STORE-CAP-0 | Focused evidence matrix + exact current contracts | none | ready |
| 1 | STORE-CUSTOMIZER-CLEANUP-1 | Correct fixed-chrome click-to-edit interaction semantics without redesign | STORE-CAP-0 | ready after evidence |
| 2 | STORE-CAP-CONTRACT-1 | Smallest safe per-instance content contract + backward-compatible normalizers | STORE-CAP-0 | evidence-dependent |
| 3 | STORE-CAP-BANNER-1 | Banner edit/save/preview/publish/public runtime | STORE-CAP-CONTRACT-1 if shared content envelope required | blocked by dependency |
| 4 | STORE-CAP-BENEFITS-1 | Benefits items edit/save/preview/publish/public runtime | STORE-CAP-CONTRACT-1 if shared content envelope required | blocked by dependency |
| 5 | STORE-CAP-CUSTOM-1 | Safe structured custom-content blocks end-to-end | STORE-CAP-CONTRACT-1 | blocked by dependency |
| 6 | STORE-CAP-APP-1 | App promo from real configured app metadata/links | STORE-CAP-0 | evidence-dependent |
| 7 | STORE-CAP-FEATURED-1 | Tenant-safe featured product references + ordering + public resolution | STORE-CAP-0 / product reference evidence | evidence-dependent |
| 8 | STORE-CAP-OFFERS-1 | Offers section backed by authoritative AWJ promotion/offer data | STORE-CAP-0 / pricing authority evidence | likely Decision Gate unless authority already exists |
| 9 | STORE-CAP-VISUAL-QA-1 | Cross-capability RTL/LTR + mobile/desktop visual QA | relevant merged capabilities | blocked by dependencies |
| 10 | STORE-CAP-CLOSE-1 | Closure report + Current State + final classification | all ready work complete / gates named | blocked by dependencies |

## Task rules

- Tasks 3/4/5 should share infrastructure only when evidence proves the contract is genuinely shared; do not over-generalize early.
- Featured products must store identifiers, not copied price/stock truth.
- Offers must not create a second pricing/promotions engine.
- App promo must not claim app availability that is not real.
- Custom content must remain structured and non-executable.
- If a task reaches a real Decision Gate, document it and continue another independent ready task where possible.
- Do not start Market/Floral preset implementation in this horizon unless the owner explicitly expands scope.
- Do not add Undo/Redo or Version History unless evidence reclassifies them and the owner expands scope.
