# AWJ-TAX-ZATCA-HORIZON — Task Queue (Bootstrap V1)

> **Owner decision 2026-10-11:** TAX-ZATCA designated as the sole active Horizon on merge of activation PR #1324. Delivery execution is paused. TAX-HZ-00 is the first permitted read-only evidence pass. Candidate REM implementation remains gated on that pass and subsequent owner-approved task scope and merge approvals.


**Status:** ~~PROPOSED / NOT ACTIVATED~~ — **superseded by the owner activation decision above (TAX-ZATCA is the sole active Horizon since the merge of #1324).** Current task status: `TAX-ZATCA-RECONCILIATION-AUDIT.md` (audited at `main` `76b05f6`, 2026-10-14). This file is an *overlay* on the canonical 40-task audit remediation queue; it does not replace that queue or the current active Delivery Horizon in `docs/autonomous-engineering/TASK-QUEUE.md`.

## State vocabulary
- `merged`: PR merged on GitHub; not automatically deployed.
- `evidence-needed`: must verify current repository or external regulatory fact before implementation.
- `decision-gated`: requires explicit owner decision before scope/behavior.
- `candidate`: dependency may be ready, but no fresh evidence pass yet.
- `blocked`: prerequisite or safety gate outstanding.
- `active`: only after separate Horizon activation/handoff recorded.
- `done`: all defined verification and post-merge gates evidenced; do not equate with production release.

## Completed merged foundation
| ID | Merged evidence | Current status |
|---|---|---|
| AUDIT-1 | #1290 | merged (audit documents) |
| REM-01 | #1291, merge `999e06c52cd9e7dba3d8e16b3be00fc8d9ad9fa0` | merged, production not verified |
| REM-02 | #1304, merge `56fcac621411a10506ed626f43b4d5a99b2ed798` | merged, production not verified |
| PRINT-01 | #1315, merge `3209fcb77cc4e02b729bb74c34adf7e131869a1b` | merged, physical printer not verified |
| PRINT-02 | #1320, merge `265974693502bc734ff0e9dbd12123bf3f345b51` | merged, evidence/docs only |
| TAX-HZ-00 | #1398, merge `0c90419874594169d422515e881425e5b3b3fa70` | merged (evidence pass documents) |
| REM-03 | #1403, merge `c589ced1dcbad88ef023d8be6ead34bc58f489f0` | merged, post-merge `CI` run #9327 success, production not verified |
| REM-03b | #1410, merge `322c20cf009e0f1c917566e4930b689764651b60` | merged, post-merge `CI` run #9351 success, production not verified |
| REM-08 | #1415, merge `6670a9a7e5df063d8d42ad6872a0b5599ae8bb11` | merged, post-merge `CI` run #9359 success, production not verified |
| REM-11 | #1416, merge `cb87e17d7583d8b24eab76e87ae5dad1d78484b3` | merged (advisory SDK harness), `CI` run #9365 success; D-03a open; production not verified |
| REM-37 | #1419, merge `ff8e2332d23d156de2ca6f79646da2eccc7da4e8`; review fixes #1445, merge `38e259c8a7b2776f0f00da8ff1d14b9453e9f139` | merged, `CI` runs #9424 / #9444 success, production not verified |
| TAX-N01 | #1444, merge `17dc59af83c44ed3f4b3a4f9c59f61a5f5d3ea36` | merged, `CI` run #9437 success, production not verified |
| REM-04 | #1450, merge `899bcba4f3ecfbe4bf504c2276db2dc817daff42`; follow-up #1461, merge `51851c04ae11ac90c14e223bc44456765d0dc535` | merged, `CI` runs #9456 / #9515 success, production not verified |
| REM-05 | #1457, merge `a8a950508d533805530c324d51595fe46cdaa682` | merged, `CI` run #9532 success, production not verified |
| REM-06 | #1473, merge `76b05f69a32fb7d2c5d741708661261dfc01d6cf` | merged, `CI` run #9596 success (sqlite + pgsql), production not verified; Fiscal Close VAT line follow-up open |

> **Status update (2026-10-14).** "Merged" is not "deployed", "SDK-validated" or "compliant". The foundation list is limited to merged PRs; for everything else (including the August 2026 ZATCA pipeline PRs #503–#593 and the closed-without-merge drafts #587–#591, whose implementation was incorporated through #592) see `TAX-ZATCA-RECONCILIATION-AUDIT.md`.

## Initial queue (not an authorization to implement)
| Order | ID | Source | Depends on | Initial status | Definition of next gate |
|---:|---|---|---|---|---|
| 0 | TAX-HZ-00 | Evidence + decisions / REM-00A, REM-00B | none | decision-gated | Owner resolves active-vs-concurrent horizon, verifies production-data classification; current-main gap delta |
| 1 | REM-03 | Audit SEC-01 | none | candidate | Scope branch mutation authorization and negative tests; confirm not already fixed |
| 2 | REM-11 | Audit PH2-14 | none | candidate | Official ZATCA SDK version and offline CI harness / fixtures evidence |
| 3 | REM-04 | Audit SEC-02 | none | candidate | Verify invoice-post concurrency against latest lock-order work; avoid duplicate fix |
| 4 | REM-05 | Audit ACC-01 | none | candidate | VAT account roles and report contracts evidence |
| 5 | REM-08 | Audit SEC-04 | none | candidate | Verify revoked/disabled-user API access |
| 6 | REM-09 | Audit VAT-05, PH1-08 | none | candidate | Overflow guards and integer arithmetic regression |
| 7 | REM-12 | Audit VAT-03, VAT-11, VAT-15 | none | candidate | Regulatory rate/category design and owner ADR |
| 8 | REM-13 | Audit PH1-01, PH1-14, PH2-08 | none | candidate | Posting-time issue timestamp freeze tests |
| 9 | REM-06 | Audit ACC-02 | REM-05 | blocked | VAT role fixes merged/post-merge verified |
| 10 | REM-10 | Audit VAT-07/08/09/10/12/14, CON-12 | REM-09 | blocked | Arithmetic guard merged + owner rules |
| 11 | REM-14 | Audit PH1-02/04/18, PH2-16 | REM-13 | blocked | Issue time freeze merged and seller/buyer snapshot ADR |
| 12 | REM-16 | Audit VAT-04/06, PH1-17, PH2-04/13 | REM-11/12/13/14 | blocked | Validator, categories, time, party snapshots |
| 13 | REM-17 | Audit stamp/QR findings | REM-11/13 | blocked | SDK oracle and issue time |
| 14 | REM-18 | Audit note e-invoicing | REM-16 + REM-02 | blocked | Valid UBL invoice + sourced notes |
| 15 | REM-19–38 | Canonical remediation plan | per source matrix | blocked / unassessed | Recompute per item from current evidence; do not promote in bulk |

> **Status update (2026-10-14).** The *Initial status* column above is the bootstrap snapshot and is kept as authored. Since then REM-03 (+03b), REM-04 (+follow-up), REM-05, REM-06, REM-08 and REM-11 were merged (see the foundation table); REM-09, 12, 13, 14 and 16–18 remain unmerged. REM-06 was unblocked by REM-05. Current per-task status, counts and the dependency graph: `TAX-ZATCA-RECONCILIATION-AUDIT.md`.

> **Status update (2026-10-15, documentation only).** D-05 is **partially recorded, not resolved.** ADR-A, ADR-I and ADR-B direction is recorded in `docs/decisions/ADR-0001-invoice-issue-timestamp.md`, `docs/decisions/ADR-0002-vat-categories-and-exemptions.md` and `docs/decisions/ADR-0003-monetary-rounding-and-tax-totals.md`. REM-12, REM-13 and REM-10/16 remain decision-gated by the open regulatory gates listed in those ADRs; tax-adviser sign-off and ZATCA clarification (D-06/TAX-E01) are not obtained. **REM-13a** (persist the issuance instant at the posting boundary, preserve it through reprint/resend, align XML/QR timestamp generation with the approved representation contracts) is the *proposed* next implementation slice — **PROPOSED, NOT AUTHORIZED, NOT IMPLEMENTED; a database migration adding `issued_at` is NOT YET AUTHORIZED.**
>
> **Update 2026-10-15 (REM-13a).** The owner authorised REM-13a (Option 1) including the `invoices.issued_at` migration; it is **implemented in one Draft PR, not merged, not deployed** (`REM-13a-IMPLEMENTATION-REPORT.md`). XML `IssueTime` is settled by BR-KSA-70 (AST, no `Z`); QR tag-3 text (**Q1**) and the BR-KSA-04 time zone (**Q2**) remain unresolved regulatory questions for D-06 / TAX-E01 and no QR format was changed. REM-14 stays blocked on the merge of REM-13a.
>
> **Update 2026-10-15 (REM-14).** REM-13a is merged (`4e1ac1e`). REM-14 slices **14a + 14c** (immutable `invoices.party_snapshot` v1 captured at posting; posted invoices displayed from it; legacy `NULL` → documented live fallback) are **implemented in one Draft PR, not merged** (`REM-14-IMPLEMENTATION-REPORT.md`, audit `REM-14-AUDIT.md`). REM-14 is **not complete**: 14b (validation/preconditions/SAR guard) and the XML seller/buyer blocks (REM-15/16) remain, and P1–P6 are unresolved.
>
> **Update 2026-10-20 (REM-15a).** REM-14 is merged (`5fb6f23`). Per the owner, REM-15 is split: **REM-15a** (seller **and** buyer UBL party blocks built from the immutable `party_snapshot`, new `App\Support\ZatcaPartyXml`) is **implemented in one Draft PR, not merged** (`REM-15a-IMPLEMENTATION-REPORT.md`); **REM-15b** (posting preconditions/422, POS, `entity_type`, SAR 1,000) stays open and gated on P3/R1-077. REM-15a is **not** a compliance claim: the official SDK now passes XSD on the targeted fixtures and BR-KSA-39 is gone, but the remaining EN/KSA/QR/SIGNATURE/PIH errors belong to REM-16/17.
>
> **Update 2026-10-20 (REM-16, XML-only slice).** REM-15a is merged (`f774842`). The monetary and invoice-line UBL mapping (new pure `App\Support\ZatcaMonetaryXml`: `TaxCurrencyCode`, `LegalMonetaryTotal`, two `TaxTotal` with a single-category `TaxSubtotal`, line `TaxTotal` (KSA-11/12), `ClassifiedTaxCategory` **S/15 only**, line/document allowance and shipping charge, correct `LineExtensionAmount`/`PriceAmount`) is **implemented in one Draft PR, not merged** (`REM-16-IMPLEMENTATION-REPORT.md`). It reads stored amounts only — no calculation, rounding, classification inference or schema change. **Blocked/open:** zero-rate and non-15 % categories (REM-12), rounding method / header-discount allocation / `adjustment` (ADR-B), shipping reason code, supply date (REM-29), PIH/QR/signature (REM-17). SDK results are advisory, not a compliance claim.
>
> **Update 2026-10-20 (REM-17).** REM-16 is merged (`e885d77`). The stamp/QR/PIH correction is **implemented in one Draft PR, not merged, not deployed** (`REM-17-IMPLEMENTATION-REPORT.md`), after an evidence gate (Phase A) that independently reproduced the official samples with the OpenSSL CLI: ECDSA (DER) over the **raw 32-byte invoice hash**; `SigningCertificate` v1 + `IssuerSerial` (Java issuer format, decimal serial); certificate digest and SignedProperties digest as Base64(hex(SHA-256)) on the SDK's whitespace-preserving serialisation; QR tag 6/7 = Base64 **text**, tag 8 = DER SPKI, tag 9 unchanged; genesis PIH = the BR-KSA-26 literal; Phase-1 TLV values over 255 bytes rejected. `SignaturePolicyIdentifier`/`DataObjectFormat` are **kept** (Security Features Standard §2.3.3; SDK digest covers them; GLOBAL PASSED) — the fail-closed policy gate is unchanged. QR tag 3 unchanged (Q1 open). Existing chains are continued from their stored XML; nothing historical is regenerated (old-genesis chains → REM-25). SDK: 13/14 AWJ fixtures signed at run time with an ephemeral synthetic credential are GLOBAL PASSED (zero-rate stays a REM-12 gap). Advisory evidence only — not real ZATCA acceptance, not a compliance claim.
>
> **Update 2026-10-20 (REM-18a, XML foundation only).** REM-17 is merged (`1e03f1d`). The credit-note (381) UBL builder is **implemented in one Draft PR, not merged, not deployed, not wired into posting** (`REM-18a-IMPLEMENTATION-REPORT.md`): pure `ZatcaCreditNoteXml` (+ input objects, five-reason catalogue, read-only factory), `Invoice` root (the `CreditNote` root fails the SDK), mandatory `BillingReference` (BR-KSA-56, SDK only warns) and reason (BR-KSA-17) enforced by the builder and by structural + mutation checks in the harness, `PaymentMeansCode 10` for cash only (credit-refund code unsourced → rejected), parties copied from the source invoice snapshot. Six AWJ note fixtures: signed at run time they are GLOBAL PASSED except the zero-rate REM-12 gap. **Open:** D4 (credit refunds), D5/D7 (snapshot policy, shared ICV/PIH chain), REM-18b persistence/posting (migration), 383, ordered note lines. Advisory SDK evidence only.
>
> **Update 2026-10-21 (REM-18b-1, schema only).** REM-18a is merged (`45e95b2`). The shared-chain **schema foundation** is implemented in one Draft PR, not merged, not deployed (`REM-18b-1-IMPLEMENTATION-REPORT.md`; design in `REM-18b-SHARED-CHAIN-DESIGN.md`): `zatca_chains`, `zatca_chain_entries`, nullable ZATCA columns on `credit_notes`, DB-level immutability guards on both engines, rollback that refuses to discard chain records or issued-note artifacts. **No allocator, no F1/F2 fences, no posting or API change, no backfill.** Hard tenant deletion is unchanged and remains an unresolved retention risk for REM-36. **Next:** REM-18b-2 (allocator + F1) after owner decisions O-R2…O-R7.

> **Update (REM-18b-2, invoices only).** REM-18b-1 is merged. The shared allocator and fence F1 are **implemented in one Draft PR, not merged, not deployed, no production migration** (`REM-18b-2-IMPLEMENTATION-REPORT.md`): `ZatcaChainAllocator` replaces the `max(invoices.zatca_icv)` head read for invoices (lazy seed `max()` fixes F-6; PIH = hash of the previous document's stored XML, checked against the immutable entry hash); `InvoiceService::post` inserts the entry before the invoice update; F1 triggers on `invoices` reject an ICV without a matching entry for tenants that have a chain head and freeze the chain identity of issued invoices. Invoice XML is byte-identical to the previous rule for the same inputs. F1 `down()` refuses once any entry exists (rollback to pre-18b-2 code then forbidden). **Not in scope:** credit-note issuance, F2, 383, branch/EGS scope (REM-25), dispatch. **Next:** REM-18b-3 (note issuance + F2 + activation row) after O-R2/O-R4 and O-2…O-6.

> **Update (document integrity hardening, invoices only).** REM-18b-2 is merged (`f919de6`). A **fail-closed integrity guard before any ZATCA transmission** is implemented in one Draft PR, not merged, no migration, submission still disabled (`ZATCA-DOCUMENT-INTEGRITY-HARDENING-REPORT.md`): for an invoice with a shared-chain entry, the canonical hash of `zatca_xml`, `invoices.zatca_hash` and the immutable `zatca_chain_entries.hash` must agree, and tenant/invoice/ICV/UUID/PIH must match the entry. Checked at attempt creation, at queueing (new, retried, re-queued) and in the dispatcher snapshot check right before the only transport call site. Legacy (pre-chain) invoices keep their previous checks; no historical document is touched; `zatca_cleared_xml` writes unaffected. Closes review gaps A (hash-only), B (XML changed before registration) and C (older invoice XML never examined). **Next:** REM-18b-3 as above; optional later: database freeze of `zatca_xml`/`zatca_hash` for entry invoices.

> **Update (REM-18b-3a, rollout controls foundation).** Integrity hardening is merged (#1592, `ba2a6dc`). The **activation controls for credit-note issuance** are implemented in one Draft PR, not merged, no tenant activated (`REM-18b-3a-IMPLEMENTATION-REPORT.md`): `zatca_rollout_controls` (tenant and platform scopes, disabled by default, missing tenant row = disabled, platform row `enabled=false` = emergency stop that overrides every tenant) and `zatca_rollout_control_events` (append-only audit with actor, previous/new state, reason, version), guarded in the database on both engines (baseline-only creation, state changes only through a matching event via compare-and-swap, no update/delete/truncate), plus `ZatcaRolloutControlService` (reads effective state in one statement; writes only for an active platform administrator, atomically with its event; lock order tenant anchor → control row). The migration inserts nothing; there is no route, command or UI; nothing reads the controls yet. **Next:** REM-18b-3b (F2 fences on `credit_notes`, F2b gated by this table), then 3c (wire `CreditNoteService::post`; read the state last, once, lock-free).

Other independent tasks REM-07, REM-20, REM-37, REM-38 and tier dependencies stay in the **canonical** remediation plan; not omission or closure.

## Special follow-ups from prior merged work
- POS partial return versus API cumulative rounding: preserve source VAT cap and all REM-01 regression tests; do not change convention without owner-approved financial behavior decision.
- Saved/frozen layouts: credit-note discount columns not selectable via all historical persisted print contracts. Follow up before broad production print certification.
- A5 unsupported; thermal physical device test outstanding.
- Legacy credit-note finance review command and tenant/branch authorization require production operating plan; no historical writes without authorization.

## Per-task execution record template
`Task ID | owner | prerequisite merge SHAs | evidence URLs/commit | status | branch/PR | base SHA | head SHA | tests SQLite/PG/Web | official SDK (if applicable) | PRE_MERGE_REVIEW | owner merge approval | merge SHA | POST_MERGE_REVIEW | deploy (separate)`.

## Selection policy
Select the smallest highest-risk *dependency-ready and activated* task after verifying the live repo. Never infer `done` from historical audit or test green alone. Remediation tasks remain candidates until explicitly authorized under the active Horizon. Stop for merge approval and material decisions.


## TAX-HZ-00 research deliverables (owner-approved)
The read-only Evidence Pass includes **deep primary-source review** of current ZATCA/Fatoora official specifications, applicable Saudi VAT regulations and the official offline validator, plus grounded UX benchmarking of suitable accounting/ERP systems. Deliver an external-evidence register and an observed-UX comparison with direct citations, version/date checks, actionable design proposals and open decision packets. No competitor pattern may become an unreviewed financial or ZATCA rule. These deliverables are part of TAX-HZ-00 acceptance, not a licence to start product implementation.
