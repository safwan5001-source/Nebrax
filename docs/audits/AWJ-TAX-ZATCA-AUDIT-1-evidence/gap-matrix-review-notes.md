# Gap Matrix review notes — conflicts between stream findings and the official-source registers

Produced while drafting deliverable B; each item was reviewed by the lead and, where accepted, applied as a re-rating or calibration note in deliverable A (see `verification-log.md`).

## GM1a

### GM1a — conflicts and rating notes (AWJ-TAX-ZATCA-AUDIT-1)

Slice: R1-001 … R1-037 (register §2.A scope and applicability of e-invoicing; §2.B Phase-1 generation requirements). Repo pinned at `0534ef16543b01c69b416b58897337e012a9d1ab`. Official text references point to the R1 extractions in `<audit-workspace>/official/R1-work/text/`: `einv_resolution_20230519_EN.txt` ([RES-EN]) and `einv_detailed_guideline_EN.txt` ([DG-EN]).

Five items are listed in section A. Severity changes are suggestions only. The master file has not been edited.

#### A. Stream claims contradicted, unsupported or mis-rated

##### 1. PH1-17 (Stream C): the Phase-1 basis of the XML-content requirement is unsupported
- **What the stream says:** "Official requirement: UBL 2.1 KSA e-invoice XML content (Annex 2 fields; XSD/EN16931-KSA rules)", applied to every posting, including Phase-1-only tenants.
- **What the register says:** R1-019 states that in Phase 1 there is "No required format as long as the required data are present"; XML and PDF/A-3 are not mandated until Integration.
  - [RES] Annex 1 (`einv_resolution_20230519_EN.txt:419`) and Third(2)(D)(1): "The approved formats … for Integration shall be XML" (`:219-220`).
  - The Annex 2 fields that make the XML a chain document (2.2 UUID, 2.3 PIH, 2.5 ICV) sit in the Integration column (`:739-753`).
  - One nuance: [DG] 5.4, in the Generation-phase chapter, asks for archiving "in XML format without Internet connection" (`einv_detailed_guideline_EN.txt:820-822`). The binding Resolution leaves the Phase-1 format open.
- **Effect:** the stub XML is not itself a Phase-1 breach. P2 remains defensible on the finding's second ground: every stored XML is hashed into the PIH chain that Phase-2 go-live inherits. Re-cite the requirement as "Integration-phase XML content; chain inherited from Phase 1 (R1-019, R1-029, R1-030)".

##### 2. PH1-03 (Stream C): the QR duty on standard invoices is narrower than stated
- **What the stream says:** "QR code mandatory on simplified tax invoices (and their notes), recommended/required per spec on standard [official-ref to confirm]".
- **What the register says:**
  - R1-021 confirms the mandatory QR for simplified invoices and notes ([RES] Annex 1 p.11; [SEC] Table 3).
  - R1-022: the QR is optional on tax invoices in Phase 1 and mandatory from Integration, when it is ZATCA's own QR ([FAQ-21] p.5-6; Annex 2 row 2.4 in the Integration column, `einv_resolution_20230519_EN.txt:749`).
- **Effect:** for a Phase-1-only tenant, the missing A4 QR is a breach only for simplified invoices printed on A4 (POS receipts are unaffected). P1 still holds: simplified invoices are also printed on A4 outside POS, and essentially every tenant is already in a Phase-2 wave (R1-010, register §4). R1-016's note ("No general SME exemption exists; only wave timing") supports the finding's core claim that e-invoicing cannot be an opt-in application.

##### 3. SEC-08 (Stream F): one of the two recommended options would breach the register
- **What the stream says:** expected behaviour is "One consistent semantic: either the capability only gates UI/transmission … or `disabled/suspended` also stops signing/transmission".
- **What the register says:**
  - R1-001 and R1-003 put every resident taxable person under the duty to issue e-invoices for all transactions that require tax invoices.
  - R1-016 reserves suspension or cancellation of the obligation to ZATCA ([IR] Art. 53(10)), and no general exemption exists.
- **Effect:** a tenant-level toggle that stops generation, signing or transmission would let a subject tenant opt out, which only ZATCA may decide. The only compliant option is the first: generation and integration stay mandatory and independent of the toggle, as SEC-08's own recommendation ("Document that Phase-1 QR/ICV is mandatory and independent") already says. Drop the second option. P3 unchanged.

##### 4. PH2-16 (Stream D): impact understated
- **What the stream says:** "Missing tenant/VAT data degrades silently in the phase-1 path"; P3; impact "Low (data quality)".
- **What the register says:** R1-017 — a person not registered for VAT must not issue a tax invoice (any document intended to show or collect VAT); fine up to SAR 100,000 ([VATL] Art. 44; [TIG] 4.1.3). The row's own note: "ERP tenants without a VAT number must not be able to print 'فاتورة ضريبية'/show VAT."
- **Effect:** an empty seller VAT number is more than a data-quality issue. AWJ lets such a tenant issue documents titled and computed as tax invoices (C Probe 1; R1-017 = VERIFIED DEFECT). PH1-04 (P1) already carries this exposure, so the rating can stay if PH2-16 is treated as its Phase-2 duplicate. Its impact text should be corrected, or the two findings merged.

##### 5. ACC-10 (Stream B): the requirement anchor is understated; the finding may be under-rated
- **What the stream says:** the change log should be kept "≥ statutory period" `[official-ref to confirm: Implementing Regulations Art. 66]`; P3; "low likelihood of regulatory impact since the documents themselves are kept".
- **What the register says:**
  - R1-027: [RES] Annex 1 lists "Allows for log modification/deletion" among the prohibited functionalities enforced on 4 Dec 2021 (`einv_resolution_20230519_EN.txt:602`).
  - [RES] Annex 1 also says: "Any E-invoice Solution that is deemed to have enabled any of the below functions will be deemed non-compliant" (`:583`).
  - [DG] 5.6: "The system must not allow any modification on system logs that store the system's activities" (`einv_detailed_guideline_EN.txt:868`).
  - R1-036 requires time-stamped, non-modifiable logs. The penalty is violation #11 (R1-216).
- **What the code shows:**
  - `DocumentRevision` is the only activity log for invoices. It is `Prunable` after 730 days (`app/Models/DocumentRevision.php:56,66-69`).
  - Its rows are updated in place when writes are coalesced (`app/Support/RecordsRevisions.php:73`).
  - `model:prune` is not scheduled in `routes/console.php`, so deletion happens only when an operator runs it.
- **Effect:** the prune capability is an enabled log-deletion function from the prohibited list, not only a question of retention length. Suggest re-citing ACC-10 to R1-027 and R1-036 and considering **P3 → P2**. P3 stays defensible only if pruning of invoice-related revisions is disabled and the in-place merge is replaced by append-only writes.

#### B. Register support that strengthens a stream position (not conflicts)

- **PH1-09, SEC-05, ACC-05** (`[official-ref to confirm]` or "n/a – internal invariant"): anchored by three rows.
  - R1-025: [REG] Art. 5(A)(3); [RES] Third(2)(C)(1) (`einv_resolution_20230519_EN.txt:169-173`).
  - R1-026: [RES] Third(2)(C)(2) (`:175-180`); [DG] 5.4, "protect … from any alteration or undetected deletion" (`einv_detailed_guideline_EN.txt:820`).
  - R1-027: "Allow alteration or deletion of generated e-invoices or their associated notes" (Annex 1, `:600-601`).
- **PH1-01 / PH2-08:** R1-027 adds a prohibited-function anchor, "Generated with inaccurate timestamps" (Annex 1 `:603`; [DG] 5.6 `einv_detailed_guideline_EN.txt:874`). Ratings unchanged.
- **SEC-04** ("n/a – internal"): R1-027 lists "Absence of user session management" as prohibited from 4 Dec 2021 (`einv_resolution_20230519_EN.txt:598`). [DG] 5.6 defines it as logging all user activities from login onwards (`einv_detailed_guideline_EN.txt:856`), so SEC-04's surviving-token issue is adjacent rather than literal. The literal gap (no login trail) is the new gap in section C.
- **SEC-01** ("n/a – internal invariant"): [DG] 5.4, "Prevention of uncontrolled access: Access to E-Invoice Solution functions must always be via a logged in user who is granted access only to functions that are necessary to perform their role" (`einv_detailed_guideline_EN.txt:788-790`). Cited under R1-025.
- **OPS-02** ("n/a — internal invariant"): R1-036 ([DG] 5.6) requires logging all user activities tied to invoice generation. Re-dispatch actors and submission outcomes are such activities.
- **OPS-01** ("n/a — internal reliability invariant"): R1-031 — [REG] Art. 5(A)(1)-(2) and [RES] Third(2)(D)(2) require the ability to "integrate with external systems by using Application Programming Interface (API) specified by the Authority" (`einv_resolution_20230519_EN.txt:221-223`). [DG] 5.3 places the same duty in the Generation-phase chapter (`einv_detailed_guideline_EN.txt:749-755`).
- **PH2-07 and PH1-19** ("n/a"): R1-037 (Phase 1 until the wave's integration date; Phase 2 voluntarily earlier) makes the switch a per-taxpayer, date-bound decision. This supports an explicit, visible and schedulable transition instead of "any credential row".
- **PH2-10 / SUB-10 / SEC-06:** R1-030 and [RES] Third(2)(E)(2) (`einv_resolution_20230519_EN.txt:231-240`) define a Unit as the component that inserts the hash chain and generates the cryptographic stamp with its stamp identifier. Sequence and chain are therefore tied to a unit and its stamp identifier, and simulation and production CSIDs differ. This partly supports segregating the chains (consistent with GM6 §B), but still does not settle SUB-10's question explicitly.
- **PH1-10:** follow-up to GM2 conflict #9. R1-028 ("Invoices cannot be cancelled") gives a partial anchor; [DG] 5.6 extends the prohibition to invoices "generated by the system or outside it". A printed, numbered draft titled "فاتورة ضريبية" that is later deleted (and its number reused) is a document presented as a tax invoice that disappears without a credit note. P2 unchanged.
- **PH1-13:** R1-035 — no certification is required and compliance may be self-certified, but ZATCA may verify it. AWJ's landing claim acts as a self-certification that the audit evidence contradicts.
- **CON-09:** R1-024 — export file naming (VAT number + issuance date + issuance time + IRN) is among the functionalities "mandated from 4th December 2021" ([RES] Annex 1, `einv_resolution_20230519_EN.txt:410, 432-438`). The naming duty therefore already binds Phase-1-only tenants, not only from Integration (XML Standard §14). P2 unchanged.
- **PH2-13:** Annex 2 timing. The self-billing flag 1.2 is a 4-Dec-2021 field (`einv_resolution_20230519_EN.txt:698`). The third-party flag 1.3 and the nominal, export and summary flags 1.4 are Integration fields (`:717`, `:725`). The self-billing part of the declared scope limitation has applied since Phase 1. Rating unchanged.
- **PH1-12 (consistent with GM2 #1):** [DG] 5.4 ("access to the counter value should be protected from system users", `einv_detailed_guideline_EN.txt:777`), [RES] Third(2)(C)(7) (`einv_resolution_20230519_EN.txt:210-213`) and Annex 2 row 2.5 attach the no-reset rule to the tamper-resistant counter (ICV), not to the IRN. AWJ's yearly and prefix-driven IRN restarts are not an "invoice counter reset".

#### C. Gaps with no covering finding (reported in GM1a_output.json)

**R1-027 and R1-036 (`new_gap: true`): session management and activity logging.**
- **No first-use password reset.** An admin can create a user with a password (`app/Http/Requests/StoreUserRequest.php:23`; `app/Http/Controllers/Api/UserController.php:143`), and nothing forces a change at first login (grep `must_change_password|password_changed_at|first_login` over `app/` and migrations: none). [DG] 5.6: "Each system must require the user to reset the password on first use" (`einv_detailed_guideline_EN.txt:852`). The invitation path (reset link) is compliant.
- **No login trail.** Tenant login issues a token without any record (`app/Http/Controllers/Api/AuthController.php:173-201`). `last_login_at` exists only for platform administrators and storefront customer identities, and no auth-event listener exists. [DG] 5.6 requires logging "starting with login authentication" (`:856`).
- **Deletions are not logged.** `RecordsRevisions` hooks only `created` and `updated` (`app/Support/RecordsRevisions.php:32-50`). Draft deletion (`app/Services/Accounting/InvoiceService.php:458-467`) and model-level deletes leave no entry.
- **Log rows are not protected.** `DocumentRevision` has no update/delete guard and is updated in place on merge (`RecordsRevisions.php:73`).
- **Output actions are not logged.** Print, PDF, share and export run client-side and are never recorded.
- Adjacent findings that do not name these gaps: SEC-04 (deactivated tokens), PH1-09/SEC-05 (ZATCA fields and invoice lines not logged), ACC-10 (pruning), OPS-02 (submission logging).

#### D. Checked, no conflict found

The following pairs were compared against the register and are consistent:

- PH1-06 vs R1-006, R1-021 and [RES] Annex 1 (ability to generate the "associated Credit/Debit Note" for both invoice types, `einv_resolution_20230519_EN.txt:415-417`). The reason and multi-invoice points were settled in GM2 #5/#6.
- PH1-15 vs R1-034 (Arabic and Hindi numerals both count as Arabic; PH1-15 does not claim otherwise).
- PH1-05 vs R1-023 (buyer VAT on Phase-1 tax invoices when the buyer is registered).
- CON-01 vs R1-033. [DG] 5.5 on its own permits "on-premises in the KSA or in the cloud"; the KSA-location duty comes from IR Art. 66(3) and [TIG] 8.3.1 (R1-191), which CON-01 cites.
- CON-03 vs R1-005(E); CON-08 vs R1-013 and R1-009; CON-04 vs R1-015.
- SUB-01 vs R1-009 ("Uncleared invoices will not be eligible for VAT deduction") and R1-022; SUB-04 vs R1-022.
- VAT-03 vs R1-007, R1-012 ("Category code O only for mixed invoices") and R1-014.
- D PC-2 and F PC-9 vs R1-012 (no gaps in ICV/PIH for documents generated on the solution).

No stream relies on the [FAQ-21] statement that integration is "not applicable" in Phase 1 beyond its Phase-1 scope (register §5 item 11).


## GM1b

### GM1b — conflicts and rating notes (AWJ-TAX-ZATCA-AUDIT-1)

Slice: R1-038 … R1-072 (register §2.C, Phase-2 integration: clearance and reporting, stamps, sharing formats, contingency, incident notification). Repo pinned at `0534ef16543b01c69b416b58897337e012a9d1ab`.

Official texts read for this file (all under `<audit-workspace>/official/`):
- `R1-work/text/einv_detailed_guideline_EN.txt` (DG v2, May 2023)
- `R1-work/text/einv_detailed_technical_guideline_EN.txt` (DTG v2, Nov 2022)
- `R1-work/text/einv_resolution_20230519_EN.txt` (RES)
- `R2-work/text/DEVELOPER-PORTAL-MANUAL.txt` (Nov 2022)

Severity changes are suggestions only. The master file has not been edited.

#### A. Register cross-reference errors that affect the finding-to-source mapping

##### 1. R1-042 note and CON-09: violation #17 is R1-222, not R1-221
- **Register R1-042 note:** "Violation #17 if not shared in required format (R1-221)".
- **Register §2.L:** R1-221 is e-invoicing violation #16 (data fields missing in documents shared with ZATCA). R1-222 is violation #17 (not sharing with customers in the required format).
- **CON-09 "Official requirement":** repeats "failure to share in the required format is violation #17 [R1-221]".
- **Effect:**
  - CON-09 needs a citation fix (R1-221 → R1-222).
  - In the inverted mapping CON-09 belongs on R1-222. GM4's R1-222 row (findings SUB-01, SUB-04, PH1-03, PH1-06, PH2-05; `new_gap: true`) predates CON-09. It should add CON-09 and drop its `new_gap` flag.
  - No rating change.

##### 2. R1-052 note: the failure-to-notify penalty is R1-219, not R1-218
- **Register R1-052 note:** "Failure to notify is its own violation (R1-218)".
- **Register §2.L:** R1-218 is violation #13 (archiving). R1-219 is violation #14 (not notifying incidents).
- **Effect:** CON-05 already cites R1-219 correctly, so only the register note needs fixing. No rating change.

#### B. Stream claims checked against the register in this slice

##### 3. PH2-08 / PH1-01: "forbid back-dating of e-invoices" would contradict the contingency and re-issue rules
- **What the streams say:**
  - PH2-08 expects the issue date/time to be the posting moment, and recommends "either forbid back-dating of e-invoices or document the policy".
  - PH1-01 wants one issue timestamp captured at posting, with `invoice_date` equal to it or validated against it.
- **What the register says:**
  - R1-064 (DG FAQ p.60) supports the default rule: the issue date is the date the final invoice is generated.
  - R1-063 (DG §10, `einv_detailed_guideline_EN.txt:1725-1727, 1779-1782`): after a device or system failure the merchant generates the e-invoice and reports or clears it "with transaction date".
  - DTG FAQ (`einv_detailed_technical_guideline_EN.txt:2758-2760`): after the failure is resolved, "all the transactions that took place during the system downtime should be cleared/reported".
  - DTG FAQ (`:2739-2746`): a re-submitted simplified invoice after a reporting rejection gets a new UUID, ICV, hash and timestamp, but "the date on invoice should remain as when transaction took place". For standard invoices the date is updated (`:2768-2775`).
- **Effect:**
  - Both findings are right for the normal path.
  - The fix must keep an audited exception for contingency regeneration and for re-issuing rejected simplified invoices, where the document date is the transaction date. A blanket ban on past issue dates would break R1-063.
  - Ratings are unaffected.

##### 4. SEC-03: "revert to Phase-1" is not a permitted fallback for integrated tenants
- **What the stream says:**
  - Expected behaviour: an explicit, audited "signing on/off / revert to Phase-1" control (or credential delete) for `company.manage`.
  - Official requirement: "ZATCA e-invoicing requires continuous issuance [official-ref to confirm]".
- **What the register says:**
  - "Continuous issuance" is supported by R1-061 (keep issuing simplified invoices while ZATCA is unresponsive) and R1-052 ("promptly resume generation").
  - R1-041 requires that, from the integration date, simplified invoices are stamped with the solution's CSID and carry the 9-tag QR before they reach the buyer.
  - When the solution cannot generate e-invoices, the prescribed path is R1-063: notify ZATCA, issue manually, keep records, and regenerate compliant e-invoices once fixed.
- **Effect:**
  - A switch back to unsigned Phase-1 output after a tenant's integration date would issue non-compliant documents. That option is contradicted.
  - The rest of SEC-03 stands: the credential delete/repair path, expiry warnings and the readiness gate.
  - The compliant recovery path is the R1-063 contingency (a manual-invoice register plus regeneration), which CON-05 covers.
  - The P1 rating is unaffected.
  - PH2-07's advice to keep fail-closed for simplified invoices and make misconfiguration impossible is consistent with R1-041.

##### 5. Duplicate submission: two official texts differ (supports the SUB-06 re-rating; no further change)
- **R1-057** (DG FAQ p.60, `einv_detailed_guideline_EN.txt:2087-2089`, May 2023): "ZATCA does not allow the same document to be submitted twice. However, this will not be rejected at the time of submission."
- **DTG FAQ** (`einv_detailed_technical_guideline_EN.txt:2787-2793`, Nov 2022): "There are no restrictions on submitting same document more than once … ZATCA will consider the Invoice only once based on unique identifiers such as UUID and hash."
- **Re-sending is prescribed after a transport failure:**
  - The DG p.53 response table (`:1872-1886`) says 413/429/500/503/504 mean "invoice not received — Please resend".
  - DG §10 scenario 4 (`:1489-1491`): "continue re-submitting same invoice until ZATCA servers are responding".
  - R1-061: retry reporting at regular intervals until successful.
- **Effect:**
  - This agrees with GM6 #5: re-sending after a transport failure is prescribed, which supports SUB-06 at P3.
  - The duplicate rule bites on re-sending a 400-rejected document unchanged. That is SUB-07, recorded on R1-056 and R1-057.
  - SUB-06's claim that "a 400 on the duplicate would record the invoice as rejected although ZATCA holds it" stays unsupported: both texts say duplicates are not rejected.

##### 6. SUB-02 / SUB-11: meaning of HTTP 303
- **What the streams say:**
  - SUB-02 describes 303 as "standard invoice sent to Reporting while clearance is enabled / clearance disabled", citing the Developer Portal manual.
  - SUB-11 treats 303 as a non-rejection status.
- **What the register says:**
  - R1-059 (DG p.53 `einv_detailed_guideline_EN.txt:1863`; DTG FAQ `einv_detailed_technical_guideline_EN.txt:2780-2786, 2387-2396`): 303 means "Clearance switched off — please submit via reporting". No stamp or QR is returned and the document is reported instead.
  - SUB-02's first meaning appears only in Developer Portal manual FAQ 9 (`DEVELOPER-PORTAL-MANUAL.txt:2055-2057`, Reporting API: "Returned when the submitted invoice is a Standard Invoice while clearance is activated").
  - FAQ 10 of the same manual (`:2074-2077`) repeats that sentence for the Clearance API, where it cannot apply. That FAQ text is therefore unreliable.
- **Effect:**
  - SUB-11's core claim (303 is not a rejection) is supported by R1-059.
  - The same DG table confirms SUB-11's "[official-ref to confirm]" items: 401 = "Check authentication certificate and secret and resubmit"; 413 = "Payload Too Large, invoice not received".
  - SUB-02's "sent to Reporting while clearance is enabled" meaning is not in R1. It is harmless for AWJ, which never routes standard invoices to Reporting (`ZatcaSubmissionService.php:37-41`).
  - No rating change.

##### 7. R1-069 / R1-071 reinforce GM6 conflicts #1 and #2 (D3 standard vs SDK)
- **What the register says:**
  - R1-069: the security, XML and data-dictionary standards are integral to the Resolution annexes and "must be abided by". For the Security Features standard: "This file is an essential part of this annexure" (`einv_resolution_20230519_EN.txt:626-628`).
  - R1-071: the sandbox, SDK and web validator are means of verification, "not an obligation".
- **What the streams say:** Streams D and E take the SDK as the operative reference. PH2-02 says "embed only the leaf certificate". PH2-06 says "ZATCA's profile does not have" a policy and calls the configured one a "fabricated policy".
- **Effect:**
  - Where the SDK and D3 diverge, D3 is the legally binding text. The SDK shows what the platform will most likely reject.
  - This reinforces GM6's suggested wording: D3 and the SDK diverge, and leaf-only should not be required unless the platform is shown to reject a chain.
  - PH2-06 is already at P2. The P0 ratings of PH2-01, PH2-02 and PH2-03 stand, because SDK rejection is certain.

##### 8. PH2-03: the QR tag-3 format is not required to omit "Z"
- **What the stream says:** PH2-03 expects tag 3 as `yyyy-MM-dd'T'HH:mm:ss` with no `Z`.
- **What the register says:** R1-045's own source text, the Resolution's QR table (`einv_resolution_20230519_EN.txt:531-532`), gives the example "2022-02-21T12:13:57Z".
- **Effect:**
  - A `Z` form is not wrong in itself. The defect is the mismatch with the XML IssueDate/IssueTime and the draft-time source.
  - This adds an R1 source to GM6 #7. PH1-14's "canonical UTC Z" target is consistent with the Resolution example.
  - No rating change.

#### C. Checked, no conflict found

The following pairs were compared against the register and are consistent:
- SUB-01 vs R1-039 (DG 6.4; DTG 4.3.2 "only considered valid if it has already been cleared").
- SUB-04 vs R1-042, R1-045 and R1-046. RES Annex 1 says tags 7/8 of cleared tax invoices come from ZATCA's platform (`einv_resolution_20230519_EN.txt:543-553`).
- SUB-05 vs R1-040 and R1-061. Both require reporting within 24 hours and a notification via ZATCA's form if reporting fails within 24 hours (DG `:1631-1637`).
- SUB-07 vs R1-056. A rejected invoice is re-submitted as a new invoice with its own ICV and hash, and the rejected hash/counter is not changed (DG FAQ `:2115-2120, 2178-2182`). The DTG date rule in item 3 is already reflected in SUB-07 for standard invoices.
- PH2-09 vs R1-047: OTP, CSR, compliance CSID, compliance checks, production CSID, renewal and revocation; every device must be registered (DG FAQ `:2056-2058`).
- PH2-10 / SUB-10 / SEC-06 vs R1-044, R1-047 and R1-053. No row in this slice says simulation and production need separate chains, so register support stays indirect (as GM6 §B). DTG FAQ (`:2777-2778`) adds that the PIH is based on the immediately preceding document, even if that document was rejected. AWJ already does this (E PC-9).
- CON-05 vs R1-052, R1-061, R1-062, R1-063 and penalty R1-219.
- CON-03 vs R1-065 (type 386 + PrepaidAmount).
- PH1-13 vs R1-054. ZATCA publishes the vendors that declared compliance, which makes AWJ's "compliant with both phases" copy relevant beyond marketing.
- PH2-07 vs R1-041 (keep fail-closed signing for simplified invoices).
- SUB-05's expected automatic enqueue vs R1-050 ("periodic batch upload"). Either a per-invoice queue or a periodic batch satisfies R1-050.

#### D. Gap with no covering finding (recorded as `new_gap: true` in GM1b_output.json)

- **R1-048, key protection.** The register requires the stamping key to be marked non-exportable, disk encryption if the key is stored in software, a new key on CSID renewal, and safe preservation of CSIDs. AWJ falls short on each point:
  - It imports a user-generated private key (`app/Http/Requests/UpdateZatcaCredentialRequest.php:28`).
  - It stores the key under one `APP_KEY` envelope (`app/Models/ZatcaCredential.php:20`), with no HSM/KMS and no non-exportable marking.
  - It does not require a different key when the CSID changes (`app/Services/Accounting/ZatcaCredentialService.php:61-73`).
  - It generates a temporary `APP_KEY` when none is set (`deploy/entrypoint.sh:59-62`).
- **Existing coverage is partial:**
  - PH2-09 covers the absence of server-side key generation.
  - SEC-03 covers the outage caused by an `APP_KEY` rotation.
  - No finding addresses key custody itself. Stream D §5 flagged it to Stream F, and F produced no finding.
- **Suggestion:** a new SEC or CON finding (P2), or extend PH2-09's scope. Production disk encryption is NOT VERIFIED.


## GM2

### GM2 — conflicts and rating notes (AWJ-TAX-ZATCA-AUDIT-1)

Slice: R1-075 … R1-123 (register §2.D tax/simplified invoice issuance and content; §2.E credit/debit notes). Repo pinned at `0534ef16543b01c69b416b58897337e012a9d1ab`. Official text references below point to the R1 extractions in `<audit-workspace>/official/R1-work/text/`.

#### A. Stream claims contradicted or unsupported by the register

##### 1. PH1-12 (Stream C): the stated requirement goes beyond the register, and the finding may be over-rated
- **What the stream says:** "Sequential invoice numbering without gaps per series". The title and actual behaviour also count "restarted … per branch" as part of the defect.
- **What the register says:** R1-103 requires a sequential number that uniquely identifies the invoice. It states that "different sequences per branch are acceptable 'provided that the Tax Invoice is clearly and distinctly defined and follows a sequence'" ([DG] 2.14 p.11; text `einv_detailed_guideline_EN.txt:347-353`). The row's note also says the IRN (BT-1) is distinct from the ICV counter. The DG FAQ applies "there should not be gaps" to the **Counter Value and the sequence of Previous Invoice Hash** (`einv_detailed_guideline_EN.txt:2149-2152`), not to the IRN.
- **Effect:** Separate per-branch series are explicitly allowed. A gap-free IRN is not a stated requirement; the gap-free rule applies to the ICV, which AWJ meets (C PC-7, D PC-2). What remains valid:
  - a printed draft's number can later be reused by a different issued invoice (the real exposure, carried by PH1-10);
  - service-level callers can inject numbers (no HTTP path);
  - mid-year prefix edits create parallel series, which are acceptable only if each series stays distinct.
- **Recommendation:** Reword PH1-12 and consider lowering it from P2 to P3, with the residual exposure carried by PH1-10.

##### 2. PH1-11 (Stream C): half of the stated requirement is unsupported
- **What the stream says:** "Simplified tax invoice must be titled as such and show date and time of issue". The finding title adds "… shows date only (no issue time)".
- **What the register says:** R1-099 says issue time is "mandatory from Phase 1 (not required on the printout)". In [RES] Annex 2 row 3.2, the visible column reads "Not Required" in both the tax-invoice table and the simplified-invoice table (`einv_resolution_20230519_EN.txt:766` and `:1080`). R1-101 supports the title requirement (Annex 2 row 1.1: "Document title is Simplified Tax Invoice", `:1027-1029`).
- **Effect:** Drop the "no issue time" element. The wrong title on every POS receipt still justifies P2.

##### 3. PH1-15 (Stream C): wrong article cited
- **What the stream says:** "Tax invoices must be issued in Arabic … — VAT IR Art. 53(1)".
- **What the register says:** R1-082 places the rule in IR Art. 53(5) chapeau (p.51) and Art. 66(2) (p.61). Art. 53(1) defines when a tax invoice is required (R1-075).
- **Effect:** Citation fix only. The substance and the P2 rating stand.

##### 4. PH1-05 (Stream C): parts of the stated requirement are overstated
- **(a) Simplified invoices to VAT-registered buyers.** The stream says "simplified invoices are for B2C" and treats any simplified invoice to a VAT-registered buyer as a defect. R1-077 (IR 53(1)(c)) permits simplified invoices for 53(1)(a) supplies under SAR 1,000. The defect therefore applies only at SAR 1,000 and above.
- **(b) Buyer VAT number.** The stream attributes the buyer VAT number requirement to "Art. 53(5)". Under R1-083(d), Art. 53(5) requires the customer TIN only where the customer self-accounts. The buyer VAT number on tax invoices is conditional under [RES] Annex 2 5.3 / [TIG] 4.2.3 (R1-092; register §5 item 8).
- **(c) Additional buyer ID.** The expected behaviour has posting *require* a CRN/other ID when the buyer is not VAT-registered. R1-092 says a missing additional ID is "accepted with warnings", so a hard block is stricter than ZATCA. Per CLAUDE.md rule 6 it should be a configurable policy.
- **Effect:** P1 is still supported, because buyer name and address (mandatory under 53(5)(e)) are never printed or emitted, and the buyer VAT number is absent from the XML.
- **Uncovered refinement (recorded in R1-075 notes):** The classifier ignores `partners.entity_type` (`app/Services/Accounting/InvoiceService.php:444-446`). Non-taxable legal persons therefore default to simplified, although R1-075 (IR 53(1)(a)(1)) requires a tax invoice for them.

##### 5. PH1-06 (Stream C): "mandatory reason" is assigned to the wrong phase
- **What the stream says:** This Phase-1 finding states that notes are issued "without a mandatory reason".
- **What the register says:** R1-116 makes the reason "mandatory (Phase 2, visible)" ([RES] Annex 2 13.2 pp.33, 35). The Phase-1 duties are the reference to the invoice (R1-113: IR 54(4)-(5); Annex 2 13.1 conditional, visible, P1) and generation of the electronic note.
- **Effect:** For Phase-1-only tenants a missing reason is not yet a breach. P1 remains justified by the missing reference and the missing QR/e-note.

##### 6. PH1-06 / ACC-06: the recommended fix would not meet R1-117
- **What the streams recommend:** Making a single `original_invoice_id` mandatory (C), and same-partner/cumulative checks on that single link (B).
- **What the register says:** R1-117 allows one note to adjust several invoices of the same customer, provided it references each one (an IRN range is acceptable) ([DG] 4.3 p.19, FAQ p.63; [TIG] 7.2.1). R2-022 also notes that "one supply-date range may cover several originals".
- **Effect:** The fix needs a many-to-many link between notes and invoices, not a mandatory single foreign key (schema today: `credit_notes.original_invoice_id`, migration 000018:30). Recorded as `new_gap` on R1-117. Neither finding's rating changes.

##### 7. Stream D Appendix A (PaymentMeans row): understates the legal requirement for tax invoices
- **What the stream says:** `cac:PaymentMeans/cbc:PaymentMeansCode` (BT-81) is "O" (optional) for standard invoices.
- **What the register says:** R1-097 makes payment means "mandatory on tax invoices from Phase 2 (not required to be visible); optional on simplified invoices". The Resolution text confirms this: the tax-invoice table row 9.1 reads "Mandatory" (`einv_resolution_20230519_EN.txt:965-968`) and the simplified table reads "Optional" (`:1263`). By contrast, R2-021 and Data Dictionary 2023 mark BT-81 "O" and treat BR-KSA-16 as a warning.
- **Effect:** This is a discrepancy inside the register (legal Resolution vs technical dictionary). The Resolution, whose Arabic text prevails, controls for tax invoices. AWJ's status does not change because it emits no PaymentMeans at all (R1-097 = NOT IMPLEMENTED), but D's matrix should read "M (standard, Phase 2, per Resolution) / O (simplified)".

##### 8. Stream A (VAT-01, VAT-14, VAT-16): wrong section of the Retail Guideline
- **What the stream says:** "VAT Retail Guideline issue 3 §4.3: VAT in an inclusive price = price × 15/115" and "§4.3 (displayed prices include VAT)".
- **What the register says:** R1-108 cites [RSG-EN] Issue 3 §4.1 p.15. In the RSG text, §4.1 "General Requirements" contains both the price-display rule and the 15/115 formula (`vat_retail_guideline_EN.txt:458-473`); §4.3 covers "Goods and Services Sold at a Single Price" (`:637`).
- **Effect:** Citation fix only.

##### 9. PH1-10 (Stream C): requirement not anchored in this slice
- **What the stream says:** "Only issued invoices are tax invoices; documents that are not tax invoices must not be presented as such [official-ref to confirm]".
- **What the register says:** No GM2 row states this directly. The nearest are R1-101 (the title states the document type) and R1-102 ("A tax invoice shall be issued only once"; re-printing must not alter the number or date). Register §6 item 8 points to R1-064 (draft/approval workflows that generate the ZATCA document before finalisation), which is outside GM2.
- **Effect:** Unsupported within GM2 but not contradicted. The lead should anchor PH1-10 on R1-064 and R1-102.

##### 10. VAT-13 (Stream A): the cumulative cap is supported only by inference
- **What the stream says:** "Guideline v3 §7 (… cumulative credits cannot exceed it) [official-ref to confirm cumulative-cap wording]".
- **What the register says:** No GM2 row states an explicit cumulative cap. The cap follows from R1-110 (IR 54(1): a credit note applies where the VAT shown exceeds the VAT due) and R1-119 (IR 40(1) adjustment events).
- **Effect:** Supported by inference only. No rating change.

#### B. Positive-control scope note

##### 11. C PC-8: narrower than it reads
- **What the control says:** "A template cannot hide QR/totals".
- **What the code shows:** This holds at block level only. Among item columns, only `description` and `total` are mandatory (`app/Support/PrintTemplateContract.php:83`; web `REQUIRED_ITEMS_COLUMNS`, `web/src/modules/documents/registry/document-types.ts:145`). No VAT-rate or line-discount column exists (`PrintTemplateContract.php:72-82`).
- **Effect:** A published template can drop quantity, unit price and line VAT, which Annex 2 rows 7.3, 7.4 and 7.10 require to be visible. In addition, the printed VAT label is hard-coded "(15%)" (`web/src/messages/ar.json:2184`; `presentation/visual-v2.ts:131`). Both points are recorded as `new_gap` on R1-083, R1-095, R1-096, R1-098 and R1-106.

#### C. Checked, no conflict found

The following pairs were compared against the register and are consistent:

- CON-02 vs R1-114 and R1-120.
- CON-03 vs R1-075(2) and R1-078.
- CON-04 vs R1-121 and R1-122.
- ACC-04 ("credit note issued after submission adjusted in the period it was issued") vs R1-120 (IR 40(5): the later of the event period and the credit-note period). These agree in effect.
- ACC-06 vs R1-113 and R1-118.
- PH2-05 and SUB-04 vs R1-113, R1-115 and R1-116.
- PH1-01 and PH2-08 vs R1-099, R1-100 and R1-102.
- PH2-13 vs R1-080, R1-087 and R1-088.
- PH1-04 vs R1-089.

No stream relies on the RSG 6.1 "whichever earlier" wording or the IEG 11.1 simplified-invoice timing wording that register §5 items 1-2 flag as superseded by the IR.


## GM3

### GM3 — conflicts and rating notes (AWJ-TAX-ZATCA-AUDIT-1)

Slice: R1-125 … R1-173 (register §2.F tax point; §2.G taxable amount, discounts, rounding, currency; §2.H tax categories and VATEX grounds; §2.I input tax, reverse charge, imports). Repo pinned at `0534ef16543b01c69b416b58897337e012a9d1ab`.

Compared: the "Official requirement" / "Expected behavior" text of the 33 findings cited in `GM3_output.json` against these rows. I also used the register's §3 (return box table) and §5, the R2 rows they point to (R2-009, R2-026, R2-029, R2-071), and these extracted texts:
- `<audit-workspace>/official/R1-work/text/`: `vat_tax_invoicing_records_guideline_EN.txt`, `vat_retail_guideline_EN.txt`, `norm/vat_law_AR.txt`, `norm/vat_implementing_regs_AR.txt`;
- `<audit-workspace>/official/R2-work/`: `text/xml-std-2023.txt`, `rules-ksa.txt`, `rules-en.txt`.

Nine conflicts are listed in section A. Severity changes are suggestions only. The master file and `GM3_output.json` have not been edited.

#### A. Stream claims contradicted or unsupported by the register

##### 1. VAT-03 (P1): wrong rule IDs, and reason codes do not exist at line level
- **Stream claim:** The requirement cites "R-KSA-09/R-KSA-13 (exemption reason codes at document and line level)". The impact says "Phase-2 XML cannot be valid (BR-CO-04/18, R-KSA-13)".
- **Register:**
  - R1-158 ([XML] 11.2.4; BR-KSA-69): each E/Z/O **breakdown** carries a VATEX code and text.
  - R1-159: BR-KSA-11/12/13 require category-O lines, allowances and charges to carry rate 0.
  - In the SDK rules, BR-KSA-09 is the seller-address rule (`rules-ksa.txt:112`) and BR-KSA-13 is the O-category document-charge rate (`:238`).
  - R2-026: the reason-code rules are BR-KSA-23/24/69/83/CL-04. All are **warnings** and all apply to BG-23 (the document-level breakdown). The line-level `ClassifiedTaxCategory` has no reason element.
- **Effect:** Re-cite the rules. P1 is unaffected:
  - it rests on BR-CO-04 and BR-CO-18, which are errors that fail 18/18 AWJ outputs (GM3 row R1-158);
  - it also rests on return boxes 2–5 (register §3), which cannot be produced.
  - Remediation may capture the reason per line, but must emit it per breakdown.

##### 2. VAT-11 (P3): described as "good practice", but there is a statutory basis
- **Stream claim:** "n/a (good-practice); credit notes must carry the original invoice's rate (Guideline §7) [official-ref to confirm transitional rules]". The recommendation says "resolve by `invoice_date`".
- **Register:**
  - R1-133: VAT Law Art. 18 says "the rate due is the rate applicable at the date of supply or date of import" (Arabic text verified, `norm/vat_law_AR.txt:193-195`). The row note adds that rate-change handling "must key off tax point".
  - R1-113 (a note carries the Art. 53 details of the related invoice) supports, by inference, the rule that a credit note inherits the rate.
- **Effect:**
  - Re-cite VAT-11 to VATL Art. 18.
  - The recommendation should resolve the rate by tax point (R1-125/R1-126), not by `invoice_date`. These differ whenever supply precedes the invoice; that gap is carried by CON-07.
  - P3 stands: the rate has been stable since 1 Jul 2020, and the stream already states it "becomes P1 at the next rate change".

##### 3. ACC-04 (P1): a conditional rule is stated as a general one
- **Stream claim:** "output tax is declared in the period the invoice was issued (L924-930)".
- **Register:** R1-132 ([TIG] 4.5.1 p.26) applies this rule only "if the tax invoice is issued before the actual date of supply". The TIG table heading sits at `vat_tax_invoicing_records_guideline_EN.txt:924-927`. The general rule is R1-125: tax is due at the earliest of supply, invoice issue and receipt of consideration.
- **Effect:**
  - Wording fix. ACC-04's core holds: no VAT-period freeze, and future-dated invoices are accepted. BR-KSA-04 (error, issue date ≤ today) supports the second point.
  - The over-general paraphrase is what makes B PC-8 read as compliant (see B.2). The missing derivation of supply date and earliest-of is carried by CON-07.

##### 4. ACC-08 (P2): wrong article reference
- **Stream claim:** "[official-ref to confirm: Implementing Regulations Art. 20-23]".
- **Register:**
  - The general earliest-of rule is Unified VAT Agreement Art. 23(1), as quoted in [TIG] 4.5.1 and [RSG] 5.1 (R1-125).
  - IR Art. 20 covers only specific cases (R1-127 … R1-131).
  - IR Arts 21–23 are "supplier and taxable customer", "place of supply — priority of special provisions" and "services related to real estate" (`norm/vat_implementing_regs_AR.txt:61-66`).
- **What supports the substance:**
  - R1-125: tax is due on receipt of consideration "in whole or part".
  - R1-132 and R1-187: advances are disclosed in the return of the period received.
  - RSG Issue 3 Example 11: an online order with receipt issued and payment taken at checkout has its tax point at the order date, before transport (`vat_retail_guideline_EN.txt:887-900`).
  - RSG §10.3: on prepayment, the tax point is the date of payment or of invoice, whichever is earlier (`:1741-1744`).
- **Effect:** Citation fix only. P2 stands.

##### 5. VAT-16 (P3): "applies once orders become invoices" and "Impact: none today"
- **Stream claim:** The requirement reads "displayed consumer prices must include VAT — applies once orders become invoices". The impact reads "None today (no invoice)".
- **Register:**
  - R1-125 makes receipt of consideration a tax point regardless of any invoice. RSG §10.3 applies this to online sales.
  - RSG §4.2.1 extends the VAT-inclusive price rule to "any prices advertised in print or electronic publications" (`vat_retail_guideline_EN.txt:508-510`). So it applies to the storefront display itself, not only after invoicing. GM2 #8 already corrects the "§4.3" section reference.
- **Effect:**
  - Both statements are contradicted. Once a storefront order is paid, VAT is due.
  - That exposure is ACC-08's (P2). Fold VAT-16 into ACC-08, or reword its impact.
  - No severity change is proposed for VAT-16 itself.

##### 6. PH1-18 (P3): "Amounts in QR/XML are SAR"
- **Stream claim:** "Amounts in QR/XML are SAR (`currencyID="SAR"`), with conversion rules for foreign-currency invoices [official-ref to confirm]".
- **Register:**
  - R1-137 (IR 53(5)(j), Art. 61; TIG 4.2.2): invoice values may be in any currency. Only the VAT amount must be stated in SAR, converted at the SAMA daily rate on the tax-due date.
  - R2-009: every `currencyID` equals the document currency (BT-5), except BT-111, the VAT total in SAR (BR-KSA-CL-02). `TaxCurrencyCode` = SAR is mandatory (BR-KSA-68, error).
  - R2-071: QR tags 4/5 are the XML BT-112/BT-110 values, which are in the document currency. No row says QR amounts are SAR. How the QR treats a non-SAR invoice is NOT VERIFIED.
- **Effect:**
  - The stated requirement is wrong, but the expected behaviour (restrict to SAR, or implement BT-6/BT-111 and FX, and print SAR VAT totals) is right.
  - The defect is mislabelling tenant-currency amounts as SAR and omitting BT-6/BT-111 and the SAMA conversion.
  - P3 stands, scoped to non-SAR tenants. The BR-KSA-68 error that hits every tenant belongs to PH2-04.

##### 7. VAT-08 (P2): the composite-supply rule is not in the register
- **Stream claim:** "Delivery charges follow the VAT treatment of the supply they relate to … [official-ref to confirm the composite-supply rule in the Implementing Regulations]". Stream A §5 also lists this as open.
- **Register:** No row states a general composite or ancillary-supply rule. Partial support comes from:
  - R1-151 (IR Art. 34): international transport of goods and the related services are zero-rated, so 15% shipping on an export is wrong;
  - R1-159 (BR-KSA-11/12/13): a document charge carries its own category, and O-category charges are taxed at 0%;
  - RSG §10.3: an online purchase is "a supply of goods, including the delivery of those goods" (`vat_retail_guideline_EN.txt:1719-1720`).
- **Effect:**
  - Re-cite to R1-151, R1-159 and RSG §10.3.
  - Mark the general domestic composite-supply treatment NOT VERIFIED. Settling it needs the Agreement/IR text or a ZATCA ruling.
  - P2 stands on the export case and on the sales/purchase asymmetry.

##### 8. VAT-14 (P3) and VAT-01 (P0): the inclusive formula is anchored on a guideline instead of the IR
- **Stream claim:** RSG "§4.3": VAT = price × 15/115. VAT-14 also says receipts are "VAT-inclusive by law — Retail Guideline §4.3".
- **Register:**
  - R1-136: the formula is statutory, IR Art. 45(2): consideration × rate ÷ (100% + rate). RSG §4.1 only restates it; GM2 #8 already gives the section fix.
  - For VAT-14, the display rule binds the seller, not the buyer's bookkeeping. The purchase-side anchors are:
    - R1-162/R1-163: deduct only the input tax evidenced on the invoice;
    - R1-181 (GM4 slice): the [SFG] lists entering VAT-inclusive purchases as a common error that overstates deductions.
- **Effect:** Citation fix. Ratings unchanged.

##### 9. VAT-04 (P3): the impact statement is contradicted by the SDK tolerance
- **Stream claim:** "once `TaxSubtotal` is emitted, BR-S-09/BR-CO-17 will fail for any invoice where Σ rounded line VAT ≠ document-level VAT".
- **Register:**
  - R2-029 and R2 §5.2: BR-CO-17 and BR-S-09 are warnings, with tolerance |BT-117 − round(BT-116×rate/100, 2)| ≤ 0.01 × number of lines. Each half-up line rounding errs by at most 0.005, so a sum of rounded lines always stays within tolerance.
  - The lead's run confirms this: `R2-work/run-lead/rounding-sumLines-0.20.validate.log` gives GLOBAL VALIDATION RESULT = PASSED, as does the 0.15 document-level variant.
  - The normative rule still stands: XML std §10 (`xml-std-2023.txt:1123-1126`, R1-139) and TIG 4.2.4 (R1-138: the rounded figures are the ones used in the return).
- **Effect:** "Will fail" is wrong. The master already carries P3, so no further change. VAT-04 remains a non-conformity with the normative text; the S2 basket posts 0.20 instead of 0.15.

**Cross-slice pointer (not counted here):** ACC-03's return-box list is cited on R1-130 (box 1.2) and R1-156 (box 2). It omits both boxes and lists an intra-GCC box that the current form does not have. This is recorded in `GM4_conflicts.md` against R1-178 … R1-180 and register §3.

#### B. Register support that strengthens a stream position (not conflicts)

##### 1. Supporting rows
- **CON-03, and stream B's §4 open item** ("would be a P2 if deposits are in scope"): settled.
  - R1-125: receipt of consideration is a tax point.
  - R1-132: an advance creates a supply to the extent paid, with an invoice due within 15 days after month-end.
  - R1-187: advances are disclosed in the return of the period received.
  - CON-03's P2 is consistent with this.
- **ACC-01 / ACC-03** ("[official-ref to confirm]" for net VAT): R1-135 (IR Art. 45(1)) defines net tax as output tax minus deductible input tax, including import VAT. Register §3 box 13 matches.
- **PH2-13:**
  - R1-130 together with BR-KSA-91 ("B2G supplies attracting provisions of Article 20(5)" → KSA-40 = "GOV") and BR-KSA-92 (contract ID mandatory for B2G, error; `rules-ksa.txt:15-20`).
  - The SDK ties the B2G flag explicitly to the IR Art. 20(5) tax point.
- **PH1-05:**
  - R1-156 together with BR-KSA-25 (buyer name mandatory on **simplified** EDU/HEA documents, warning) and BR-KSA-49 (buyer ID must be NAT, error) extend the buyer-data requirement to simplified invoices in the EDU/HEA case.
  - PH1-05's expected behaviour covers standard invoices only.
  - AWJ partners have no national-ID column (grep over `database/migrations`: none).
- **VAT-07:** R1-138 (nearest halala) and R1-139 (half-up on the third decimal) both contradict the `intdiv` truncation.
- **VAT-02 / VAT-11:** R1-133 (rate at the date of supply) together with R1-113 (the note follows the related invoice) imply that a credit note uses the original supply's rate.
- **VAT-08, export case:** R1-151.
- **CON-04:** its citations match R1-165, R1-166, R1-168 and R1-170, and register §3 boxes 8/9.

##### 2. Positive-control scope notes
- **B PC-8** ("Period attribution by document date, not posting day"):
  - This is attribution by document date, not by tax point. R1-125/R1-126 place the tax point at the earliest of supply, invoice issue and payment.
  - AWJ uses `invoice_date`, which accepts any date, past or future (`StoreInvoiceRequest.php:34`). The e-invoice `IssueDate` is `created_at` (PH1-01/PH2-08).
  - The control is right only where `invoice_date` coincides with the tax point. CON-07, CON-03 and ACC-04 carry the rest.
- **Stream A PC** ("Per-line rounding is half-up — the rounding rule the XML standard §10 mandates"): §10 also requires rounding "on the final calculation results" and the category VAT "on document level" (R1-139). The control proves the half-up method only (see VAT-04).
- **Stream A PC** ("Tax-inclusive extraction is exact … (= retail guideline 15/115 formula)"): the binding anchor is IR Art. 45(2) (R1-136).

#### C. Gaps with no covering finding (new_gap rows in GM3_output.json)

| Row | Uncovered gap recorded by the drafter | Now covered by |
|---|---|---|
| R1-126 | No supply-date capture; no derivation of earliest-of(supply, invoice, payment) | CON-07 |
| R1-127 | Instalment due-date trigger; 12-month deemed-supply backstop | CON-07 |
| R1-130 | Government-procurement tax point (payment order or receipt); government customer class | CON-07 (tax point), with PH2-13 (B2G flag) and ACC-03 (box 1.2) |
| R1-141 | Deemed and nominal supplies (valuation at cost or FMV, output VAT) | CON-08 |
| R1-142 | Gift/sample thresholds (SAR 200 per recipient per year; SAR 50,000 cap) | CON-08 |
| R1-148 | 90-day export evidence and re-rating | CON-08 |
| R1-163 | No input-tax evidence control (supplier invoice number optional; supplier VAT number unchecked) | CON-08 |
| R1-167 | Art. 52 capital-asset input-tax adjustment | CON-08 |
| R1-173 | Loss, damage or theft classification and evidence | CON-08 |

Still uncovered:
- **R1-164:** the five-year limit on deducting input tax. The row records it as a minor uncovered element but does not flag `new_gap`, and no finding names it. The risk is low. Fold it into CON-08 (input-tax evidence) or ACC-04 (periods).

Minor point on CON-07: it lists R1-127 under "IR Art. 20(2)-(3)", but R1-127 is IR Art. 20(1) (instalment due date). Citation only.

#### D. Status corrections suggested

1. **R1-128: NOT IMPLEMENTED → PARTIALLY IMPLEMENTED.**
   - **Proof:** R1-128 has the same fact pattern as R1-129 (rated PARTIALLY), and R1-125 and R1-132 (both PARTIALLY) rest on the same two facts:
     - the invoice-date leg exists: the journal `entry_date` = `invoice_date` (`InvoiceService.php:1005`, verified);
     - the payment leg is missing: receipts post Dr cash / Cr AR only (`PaymentService.php:350-358`, verified).
   - R1-128 additionally lacks the 12-month backstop, which is a reason for PARTIALLY, not NOT IMPLEMENTED.
   - **R1-127** (earliest of due date, payment and invoice) would follow the same logic. Keep it NOT IMPLEMENTED only if the lead treats the instalment due-date trigger as the defining element, and record that choice.
2. **Findings-list updates (no status change):**
   - Add CON-07 to R1-125, R1-126, R1-127, R1-128, R1-130 and R1-132.
   - Add CON-08 to R1-141, R1-142, R1-148, R1-163, R1-167 and R1-173, and set `new_gap` to false on those rows. R1-141, R1-142 and R1-173 currently carry an empty `findings` list with a gap status.
   - Add CON-06 to R1-161. The printed VAT label is the constant "(15%)" even on mixed-rate invoices, and there is no rate column. The row's own note defers the print side to R1-083.


## GM4

### GM4 — conflicts and rating notes (AWJ-TAX-ZATCA-AUDIT-1)

Slice: R1-174 … R1-232 (register §2.J VAT return, periods, payment and corrections; §2.K records and archiving; §2.L penalties and violations; §2.M seller/buyer identification data). Repo pinned at `0534ef16543b01c69b416b58897337e012a9d1ab`.

Compared: the "Official requirement" / "Expected behavior" text of the 80 findings cited in `GM4_output.json` against these rows. Most findings cited only as penalty triggers on R1-198 … R1-223 make no claim about this slice; for those, only the trigger mapping was checked (section D). I also used:
- the register's §3 (return box table), §5 and §6;
- these extracted texts in `<audit-workspace>/official/R1-work/text/`:
  - `norm/vat_implementing_regs_AR.txt`, including the IR's amendment-comparison annex for Art. 66;
  - `vat_tax_invoicing_records_guideline_EN.txt` and `norm/vat_tax_invoicing_records_guideline_AR.txt`;
  - `vat_retail_guideline_EN.txt`, `einv_regulation_EN.txt`, `einv_detailed_guideline_EN.txt`;
- `<audit-workspace>/official/R2-work/rules-ksa.txt`.

Five conflicts are listed in section A. Severity changes are suggestions only. The master file and `GM4_output.json` have not been edited.

#### A. Stream claims contradicted or unsupported by the register

##### 1. ACC-03 (P1): four parts of the stated requirement do not match the register
- **(a) Box list.**
  - **Stream claim:** the return has a box for "sales to registered customers in other GCC states", followed by zero-rated domestic sales, exports, exempt sales, and so on.
  - **Register:**
    - The current form has boxes 1, **1.2**, **2**, 3–16 (R1-178; register §3; RSG §5.3.2, `vat_retail_guideline_EN.txt:965-1030`).
    - Box 1.2 is standard-rated sales to government entities (R1-180, linked to the IR Art. 20(5) tax point).
    - Box 2 is sales where the State bears the VAT (R1-179; VATEX-SA-EDU/HEA).
    - The form has no intra-GCC box. During the transitional period, goods sent to another GCC state are treated as exports (register §3 note iii; RSG §10.2.2, `:1703-1706`). IR Art. 62(2)(e) only allows ZATCA to *require* that disclosure (R1-176).
  - The stream's list therefore omits two boxes and adds one the form does not have.
- **(b) Period article.**
  - **Stream claim:** "monthly if > SAR 40m … (Implementing Regulations Art. 62 [official-ref to confirm])".
  - **Register:** R1-174 places the rule in IR **Art. 58**: the test is the preceding 12 months, a taxpayer may opt into monthly, and may revert after 2 years. Art. 62 covers the filing deadline (R1-175) and return content (R1-176).
- **(c) Adjustment period.**
  - **Stream claim:** "adjustments reported in the period of the credit/debit note (Guideline v3 §7 table L1384-1400)".
  - **Register:** the cited table (`vat_tax_invoicing_records_guideline_EN.txt:1381-1410`, R1-184, R1-120) has three cases:
    - a note issued before the original return is filed is adjusted in the note's period (Amount field);
    - a credit note issued **after** the return is adjusted in the later of the note period and the event period (Adjustments field);
    - an upward adjustment (debit note) after the return goes to the period of the **event**, not the note.
  - The stream's sentence is right only for the first case.
- **(d) Retention.** "Records retained 6 years (Art. 66 [official-ref to confirm])" is confirmed but incomplete. See A.4.
- **Effect:** Specification corrections for the remediation (the VAT-return workspace must follow §3 and the three-case table). P1 is unaffected.

##### 2. CON-01 (P1, NOT VERIFIED): the "server inside KSA" rule is stated as law, but it comes from text the IR has since removed
This is the item the drafter flagged on R1-191 ("See GM4_conflicts.md").
- **Finding claim:**
  - Title: "records must be kept on servers inside KSA for KSA-resident taxable persons".
  - The requirement quotes IR Art. 66(3) (access via a terminal in KSA) and TIG v3 §8.3.1 (residents' server in KSA) side by side as one rule.
- **Register:** R1-191 merges the same two sources into one row. Register §5 does not list a discrepancy.
- **Official texts:**
  - **IR Art. 66(3) as amended on 9 Nov 2021 (Board Res. 21-2-7; `norm/vat_implementing_regs_AR.txt:2948-2956`)** requires invoices, documents and records to be kept "in the Kingdom, on paper or electronically through access to the servers or databases where they are kept via a terminal station or terminal connection in the Kingdom". This is followed by conditions (a)–(h): extraction on request, Arabic, original documents, tamper controls, and so on. The paragraph opens "without prejudice to any [other] laws … on … electronic transactions or cybersecurity".
  - **The IR's own amendment-comparison annex (`:7104-7135`)** shows that the pre-2021 text had condition (a): "the computer system or server must be physically located in the Kingdom", with a branch-terminal exception for permanent establishments. The amendment **removed** that condition.
  - **TIG v3 §8.3.1 (May 2026)** in both languages still says "where the taxable person is resident in the Kingdom, the computer or server must be located within the Kingdom", with the same permanent-establishment workstation exception (`vat_tax_invoicing_records_guideline_EN.txt:1499-1508`; Arabic `norm/vat_tax_invoicing_records_guideline_AR.txt:1612-1619`). That is the superseded IR wording.
- **Assessment:**
  - Under the binding Arabic IR as amended, records hosted abroad but accessible and extractable through a terminal in KSA can comply with Art. 66(3).
  - ZATCA's current guideline nevertheless states the stricter rule. Other KSA rules preserved by the "without prejudice" clause (cybersecurity, electronic transactions) may impose residency independently; they are not in the register, so this is NOT VERIFIED.
  - The custodian route (R1-193, IR 66(4)) still requires a third party established in KSA.
- **Effect:**
  - Keep CON-01 NOT VERIFIED. P1 is defensible while a current ZATCA guideline states the server rule.
  - Reword the title as "records must be kept in KSA (IR 66(3)); ZATCA's TIG v3 §8.3.1 further requires residents' servers in KSA".
  - ADR-H should record which reading is adopted, backed by a tax-adviser opinion or ZATCA ruling.
  - The register's §5 should add this IR-versus-TIG discrepancy.

##### 3. ACC-10 (P3): the impact statement is contradicted
- **Stream claim:** The requirement is "records and invoices retained for at least six years [official-ref to confirm: IR Art. 66]". The impact reads "low likelihood of regulatory impact since the documents themselves are kept".
- **Register:**
  - The 6-year requirement is confirmed (R1-189).
  - The impact claim is contradicted, because log deletion is regulated independently of document retention:
    - R1-027 (Resolution Annex 1; DG 5.6) lists "log modification/deletion" among the functions prohibited since 4 Dec 2021. DG 5.6 states: "The system must not allow any modification on system logs that store the system's activities" (`einv_detailed_guideline_EN.txt:868-871`). A solution with any enabled prohibited function "will be deemed non-compliant".
    - R1-216 penalises including a prohibited function (e-invoicing violation #11).
  - The code's own premise is also contradicted. `DocumentRevision.php:55` says "two years cover a complete tax review cycle", and `:63-64` says the period is then "closed for tax". R1-194 gives ZATCA 5 years from the end of the calendar year to assess (20 years for evasion), and R1-189 requires 6 years from the end of the tax period.
- **Mitigation (verified):**
  - Pruning is not scheduled. `routes/console.php:49,55` schedules only `webhooks:prune` and `imports:prune`; there is no `model:prune`.
  - The scheduler itself is inert in the current deployment (`routes/console.php:40-42, 63-66`).
  - Deletion therefore needs an operator to run `php artisan model:prune` by hand.
- **Suggested rating:** P3 → P2, because a built-in log-deletion capability over the only trace of model-level edits (ACC-05) is a listed prohibited function. Keep P3 only if the lead decides that an unscheduled, operator-only prune is not an "enabled" function. Either way:
  - drop `Prunable`, or extend retention to at least 6 years from the end of the tax period;
  - extend coverage to credit notes, returns, expenses, payments and manual journals.

##### 4. PH1-16 (P2): the retention period is understated, one article is mis-cited, and one fact is wrong
- **Stream claim:** "Retain … ≥ 6 years … (VAT IR Art. 66; E-Invoicing Regulation Art. 5/6 storage & archival)". The title and actual behaviour say "no archive/bulk export of XML/QR, single-invoice retrieval only".
- **Register:**
  - **R1-189** (IR 66(1), `norm/vat_implementing_regs_AR.txt:2939-2943`; TIG 8.3.3, `vat_tax_invoicing_records_guideline_EN.txt:1537-1551`):
    - the general period is 6 years **from the end of the tax period**;
    - capital-asset records are kept for the Art. 52 adjustment period plus 5 years from acquisition (up to 15 years for immovables);
    - real-estate records are kept for at least **15 years in all cases**.
  - AWJ's document-retention policy is clamped to 1–3650 days (`DocumentRetentionPolicyService.php:29`, verified), so a 15-year class cannot be expressed.
  - **E-Invoicing Regulation Art. 6** is "General provisions" (time limits, Governor decisions; `einv_regulation_EN.txt:130-140`), not storage. The correct anchors are:
    - Regulation Art. 4(A)(5), which applies IR Art. 66 to e-invoices;
    - Regulation Art. 5(A)(3) (tamper-proof, `:111-112`);
    - Resolution Fifth (R1-195) and Third(2)(C)(2) (archiving in the Annex format, R1-026);
    - IR 66(3)(h) (R1-192).
- **Code fact:** A bulk export exists. `GET /api/account/export` (owner only, `routes/api.php:357`) serialises every `Invoice` row with `toArray()` (`AccountSettingsController.php:83, 117, 158-167, 172-174`). `Invoice` has no `$hidden`, so the export includes `zatca_xml`, `zatca_qr` and `zatca_hash`. GM4 rows R1-192 and R1-194 already record this.
- **What remains valid:**
  - there is no archive format (XML or PDF/A-3 files), and that gap is now CON-09;
  - credit notes, expenses, assets and Document-Center files are not exported;
  - there is no integrity report;
  - storage is a local disk;
  - unlinked archived tax documents are purged after 365 days.
- **Effect:** P2 stands. Reword the title, and make the remediation carry the 6/11/15-year classes, anchored to the end of the tax period.

##### 5. PH2-16 (P3) and ACC-12 (P3): there is an official basis where the findings say "None" or "n/a"
- **PH2-16** ("Official requirement: None"):
  - R1-224: the seller VAT number is mandatory (BR-KSA-39, error) and must have the 15-digit "3…3" format (BR-KSA-40, error).
  - R1-227: the national-address elements (BR-KSA-09/37/66, warnings).
  - R1-017: a person not registered for VAT must not issue tax invoices.
- **ACC-12** ("n/a – internal invariant"): R1-188 ([SFG] p.11, common error 5) says all CRs with taxable activity must be reflected in the return, not only the main one. A branch-filtered VAT view that drops company-wide lines works against that.
- **Effect:**
  - Re-cite both findings.
  - No rating change: PH1-04 (P1) carries the seller-VAT exposure. For ACC-12, the unfiltered report is complete per code and probes, as GM4 row R1-188 records.

**Cross-slice pointers (not counted here):**
- **PH1-15:** "IR Art. 53(1)" should be IR 53(5) and 66(2). R1-190 confirms Art. 66(2); this is already recorded in GM2 #3.
- **PH1-18 on R1-230:** the claim "amounts in QR/XML are SAR" is recorded in GM3 #6.
- **VAT-03's rule IDs** are recorded in GM3 #1.

#### B. Register support that strengthens a stream position (not conflicts)

##### 1. Return, periods and corrections
- **ACC-04:** the "[official-ref to confirm: IR Art. 63]" is confirmed by R1-177 (IR 63(1)–(5)). R1-177 adds the SAR 15,000 threshold, the 20-day notification, the 5-year limit, and the required content of a correction (periods, output/input tax corrected, reason). All of these depend on the period snapshot ACC-04 asks for.
- **ACC-01:** the "filing/return rules [official-ref to confirm]" are anchored by:
  - R1-175: IR 62(1) and 59(1), filing and payment by the last day of the following month;
  - R1-176: IR 62(2), return content.
- **ACC-11:** the "[official-ref to confirm]" for an audit trail is anchored by:
  - R1-177: a correction states its reason;
  - R1-176(j): corrections are disclosed;
  - R1-192(e)–(f): data entry must be documented, and auditable controls must prevent tampering.
- **VAT-14:** R1-181 ([SFG] pp.4–12) lists "entering VAT-inclusive purchases" as a common error that overstates deductions. That is exactly what AWJ's exclusive-only expense and asset capture produces.
- **CON-03:** R1-187 (advances are disclosed in the return of the period received).
- **CON-04:** R1-183 (box 8 versus box 9, the box-9 adjustment column, and exempt imports not disclosed).
- **PH2-13:** R1-180 (box 1.2) together with BR-KSA-91/92; R1-231 (BR-KSA-46 and BR-KSA-07 export-flag constraints).
- **VAT-03:** R1-179 (box 2) and R1-232 (BR-KSA-49: NAT ID, error).

##### 2. Records and integrity
- **ACC-05, PH1-09, SEC-05 and PH1-02** all carry "[official-ref to confirm]" tags. They are settled by:
  - R1-189 (6 years);
  - R1-192(f) (auditable tamper controls);
  - R1-217 (e-invoicing violation #12: deleting or amending e-invoices after issuance);
  - E-Invoicing Regulation Art. 5(A)(3): "tamperproof … mechanism that allows to detect any tampering" (`einv_regulation_EN.txt:111-112`; R1-025).
- **Stream B §4 and stream C §4 item 3** list items as cited from memory. These are now settled:
  - the retention article and period: R1-189;
  - the Arabic-language rule: R1-190 (IR 66(2));
  - the return-box list: R1-178 and §3, with the corrections in A.1.

##### 3. Identification data
- **PH1-04:** the "[official-ref to confirm]" is confirmed by R1-224. BR-KSA-39 (presence), BR-KSA-40 (seller format) and BR-KSA-44 (buyer format) are all **errors** (`rules-ksa.txt:144, 216`).
- **PH1-05:** R1-226 confirms GM2 #4(c). A missing buyer other ID is a warning (BR-KSA-81, warning; [DG] FAQ p.64). BR-KSA-14 is an error only on the scheme or format of an ID that is present.
  - The buyer name (BR-KSA-42), the non-SA buyer address (BR-KSA-10) and the SA national address (BR-KSA-63/67) are also SDK **warnings** (`rules-ksa.txt:146, 186, 154, 162`).
  - The legal basis for name and address on tax invoices remains IR 53(5)(e).

##### 4. Penalty and incident rows
- **SUB-05 and CON-05:** R1-214 (violation #9 applies when the document was not shared *and* ZATCA was not notified) and R1-219 (violation #14, failing to notify incidents) confirm the notification element.
- **VAT-04:** the R1-212 note ("Direct hit on POS/B2C rounding errors") and register §6 item 11 support keeping VAT-04 as a trigger for violation #6. No re-rating is proposed: the impact is at most 0.005 SAR per line, and the validator tolerates it (GM3 #9).

#### C. Gaps with no covering finding (new_gap rows in GM4_output.json)

| Row | Uncovered gap recorded by the drafter | Now covered by |
|---|---|---|
| R1-176 | Return items (c) deemed supplies and (i) Art. 52 capital-asset adjustments | CON-08, whose requirement cites R1-176 items (c) and (i) |
| R1-222 | No PDF/A-3 with embedded XML for sharing with customers | CON-09, which cites R1-221/R1-222 |

Residual elements that no finding names (the drafter did not flag `new_gap`):
- **R1-224, VAT-group number.** The seller VAT number may be the group's (R1-066: members of a VAT group put the group number on all invoices). A grep for `vat_group|group_vat|group_number` over `app/` and `database/migrations` finds nothing. No finding or CON covers this.
- **R1-225 and R1-188, branch-level CR.** Where a taxpayer has several CRs, BR-KSA-08 and R1-090 require the CR of the issuing branch as the seller's other ID. The `Branch` model has no CR or VAT attribute (`Branch.php:22-26`). This is the same residual that GM2 flagged as `new_gap` on R1-090, and no CON finding was created for it. Suggest folding it into PH2-04's remediation or creating a small finding.

#### D. Status corrections suggested

**None required.** The 59 statuses are consistent with the evidence and with the status definitions. The penalty rows are correctly NOT APPLICABLE with their trigger findings listed.

**Findings-list and notes updates (no status change):**
1. **R1-176:** add CON-08 and set `new_gap` to false.
2. **R1-222:** add CON-09 and set `new_gap` to false. Also add CON-09 to R1-218 (violation #13, archiving in the prescribed format) and to R1-192, item (h).
3. **R1-210 triggers** (violation #3, missing invoice data):
   - PH1-11 is a trigger for the wrong title on simplified receipts, not for a missing issue time. Resolution Annex 2 row 3.2 marks the time "Not Required" on the printout (GM2 #2).
   - PH1-12 is a trigger only for number reuse (carried by PH1-10). A gap-free IRN and per-branch series are not violations (GM2 #1).
4. **R1-220 triggers** (violation #15, missing QR): PH1-03 is a trigger for simplified documents in every phase (R1-021) and for tax invoices only from the integration date. R1-022 says the QR is **optional on tax invoices in Phase 1**.
5. **R1-221 triggers** (violation #16, missing data fields): remove PH2-06. It concerns an extra `SignaturePolicyIdentifier`, which D3 lists with cardinality 1 (GM6 #2); it is not a missing field.
6. **R1-223 triggers** (violation #18, other provisions): mark PH1-12, PH1-14 and SUB-06 as weak triggers:
   - PH1-12: gap-free IRN is not required (GM2 #1);
   - PH1-14: neither timestamp format is mandatory on its own (GM6 #7);
   - SUB-06: re-sending after a transport failure is the documented behaviour (GM6 #5).
7. **R1-216 triggers** (violation #11, prohibited functions):
   - ACC-10 is supported (see A.3).
   - SEC-04 does not match the DG 5.6 definitions. There, "anonymous access" means access without a unique login, and "session management" means logging user activities (`einv_detailed_guideline_EN.txt:845-857`). Keep SEC-04 only as an access-control weakness.
8. **Register erratum:** R1-195's note reads "Violation #13 (R1-217)"; violation #13 is R1-218. The drafter already noted this.


## GM5

### GM5 — conflicts and rating notes (AWJ-TAX-ZATCA-AUDIT-1)

Slice: R2-001 … R2-037 (technical XML content rules: document and transaction types, identifiers, dates, currency, ICV/PIH/QR placement, seller and buyer data, lines, allowances and charges, categories and exemption reasons, totals, rounding, prepayment, lengths, file naming, archiving). Repo pinned at `0534ef16543b01c69b416b58897337e012a9d1ab`.

Compared: the "Official requirement" / "Expected behavior" text of the 39 findings cited in `GM5_output.json` against these rows. I also used:
- the R2 register's §3 (Data Dictionary matrix), §4, §5.2 and §6;
- the extracted texts `<audit-workspace>/official/R2-work/text/xml-std-2023.txt` and `<audit-workspace>/official/R2-work/rules-ksa.txt` / `rules-en.txt`;
- the official SDK samples (`R2-reference-samples/`);
- the lead's SDK runs (`R2-work/run-lead/arith/P1…P7`, `rounding-*`) and the D-stream SDK summary (`work/D/sdk/validate-awj-outputs.summary.txt`).

Findings already settled against the registers in GM2, GM3, GM4 or GM6 are only cross-referenced here: PH2-01/02/03/06, PH1-14, VAT-04, PH1-16, PH1-15 and PH1-05. Six conflicts are listed in section A. Severity changes are suggestions only. The master file and `GM5_output.json` have not been edited.

#### A. Stream claims contradicted or unsupported by the register

##### 1. PH1-17 (P2): two of the listed XML deficiencies are not deficiencies, and a third is only a warning
This is the item the drafter flagged on R2-006 and R2-021 ("see GM5_conflicts.md").
- **Stream claim:** The actual-behaviour list includes "`ProfileID reporting:1.0` for standard too", "no `PaymentMeans`" and "no `ActualDeliveryDate`". Stream E §5 note (2) asks for the ProfileID to be "check[ed] against the XML standard".
- **ProfileID (contradicted):**
  - R2-006: `cbc:ProfileID` must be `reporting:1.0`, under BR-KSA-EN16931-01, which is an **error** (`rules-ksa.txt:296-297`).
  - The Data Dictionary marks BT-23 M×6 with value `reporting:1.0` (R2 §3).
  - All 19 official samples carry `reporting:1.0`: standard and simplified, invoice, credit and debit (`grep` over `R2-reference-samples/Standard|Simplified`: 19/19).
  - AWJ's value is therefore correct for standard documents, and E's open question is answered.
- **PaymentMeans (unsupported at the technical level):**
  - R2-021 and R2 §3 make BT-81 optional for all six document types. BR-KSA-16 applies only when the element is present.
  - Two caveats:
    - R1-097 (Resolution Annex 2 row 9.1) makes payment means mandatory on **tax** invoices from Phase 2. GM2 #7 records this as a discrepancy inside the register, resolved in favour of the Resolution.
    - On credit and debit notes, `cac:PaymentMeans` must exist as the container of the mandatory reason `cbc:InstructionNote` (KSA-10; R2-022).
- **Delivery date (overstated):** KSA-5 is required only on 388/01 tax invoices, and only as a **warning** (BR-KSA-15; R2-020). Data Dictionary C×6.
- **Effect:**
  - Drop the ProfileID item.
  - Qualify payment means as "tax invoices from Phase 2 (R1-097) and notes (R2-022)".
  - Qualify KSA-5 as a warning on standard invoices.
  - P2 stands on the other gaps: no TaxCurrencyCode (BR-KSA-68 error), no category or breakdown (BR-CO-04/18 errors), the XSD failure, and the stub being hashed into the chain.

##### 2. VAT-06 (P1): wrong section, one rule mis-described, impact partly overstated, and the "adjustment" mapping is unsafe
- **(a) Wrong section.**
  - **Stream claim:** "BT-131 … (§9.5, local lines 666-690)".
  - **Register:** Lines 652-705 of `xml-std-2023.txt` are §9.3, "Calculation on invoice line level" (R2-028 cites D1 §9.3 p.17). §9.5 is the prepayment calculation (R2-031).
  - The §9.3 formula also adds line charges: "− BT-136 + BT-141".
- **(b) BR-KSA-51 mis-described.**
  - **Stream claim:** "BR-KSA-51/52/53 (line VAT and line amount with VAT mandatory for tax invoices)".
  - **Register:** BR-KSA-51 is the KSA-12 = BT-131 + KSA-11 arithmetic rule, a warning. BR-KSA-52/53 are the mandatory-element rules, which are errors (R2-023, R2-028).
- **(c) Impact partly overstated.**
  - **Stream claim:** "certain rejection at Phase-2 clearance/reporting for any invoice with discounts, shipping, adjustments or inclusive pricing".
  - **Register:** Among the cited arithmetic rules, only BR-CO-15 is an error (BR-CO-11/12 also are, once allowances or charges are emitted). BR-CO-10/13/16/17, BR-S-08/09, BR-KSA-51 and BR-KSA-EN16931-11 are warnings (R2 §5.2; R2-058: a warning means "accepted but non-compliant").
  - **The lead's SDK runs confirm this:**
    - `arith/P2` and `P4` (BT-112 ≠ BT-109 + BT-110): FAILED.
    - `P3`, `P5`, `P6` and `P7` (line net ≠ qty × price, inclusive price in BT-146, payable ≠ total): GLOBAL **PASSED** with warnings.
  - **What follows:**
    - AWJ's header discount, shipping and adjustment break BR-CO-15 and are rejected (GM5 R2-024 and R2-027 evidence: 190.00 + 27.75 ≠ 212.75; 100.00 + 16.50 ≠ 126.47).
    - Inclusive-price and line-discount-only misstatements are accepted with warnings.
  - P1 stands, because header discounts and shipping are common. The impact sentence should be narrowed.
- **(d) The adjustment mapping is unsafe.**
  - **Stream claim:** the expected behaviour maps AWJ's `adjustment` to `cbc:PayableRoundingAmount`.
  - **Register:** R2-030 defines BT-114 as the payable **rounding** amount ("may be negative e.g. −0.01").
  - **Code:** AWJ's `adjustment` is a free, non-taxable field bounded only to ±100,000,000,000 halalas (`StoreInvoiceRequest.php:38`, commented "تسوية/تقريب (+/−)"). It posts to the `document_adjustment` role, credit when positive (`InvoiceService.php:994-1001`).
  - Mapping a large adjustment to BT-114 would misrepresent it. Values beyond a rounding tolerance must become document allowances or charges with a VAT category (R2-024).
  - Related: the stream A matrix row 14 conclusion, "adjustment … can only over-declare VAT, never under", was tested only with −15.00. A **positive** adjustment adds consideration that carries no VAT. See section C.

##### 3. PH2-11 (P2): the official standard itself fixes the genesis value
- **Stream claim:** The genesis PIH comes from the "SDK `Data/PIH/pih.txt` and all 19 official samples … BR-KSA-26 only requires base64 SHA-256".
- **Register:**
  - R2-011 gives the value `NWZlY2Vi…` and cites D1 BR-KSA-26 among its sources.
  - The rule text in the XML Implementation Standard v1.2 reads: "For the first invoice, the previous invoice hash is "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==", the equivalent for base64 encoded SHA256 of "0" (zero)) character" (`xml-std-2023.txt:2069-2076`).
- **Effect:**
  - "Only requires base64 SHA-256" is contradicted, in a way that strengthens PH2-11: AWJ's genesis value violates the published standard, not only an SDK convention.
  - Re-cite to D1 BR-KSA-26.
  - P2 is kept, because only the first document of a chain is affected. The lead's SDK run with the official `pih.txt` fails KSA-13 (GM5 R2-011).

##### 4. VAT-03 (P1) and VAT-15 (P3): the rate domain is understated
- **Stream claims:**
  - VAT-03's expected behaviour: "validation: Z/E/O require a VATEX code, **S requires rate > 0**".
  - VAT-15: "Official requirement: n/a".
- **Register:**
  - R2-025: category ∈ {S, Z, E, O} (BR-KSA-18, error).
  - The S rate must be **15 or 5** (BR-KSA-84, error, `rules-ksa.txt:268-269`), and Z/E/O carry rate 0.
  - The same restriction applies to allowance, charge and prepayment categories.
- **Code (per GM5 row R2-025):** AWJ accepts any integer rate 0–100 per line and as the sales default (`StoreInvoiceRequest.php:67`; `UpdateSalesSettingsRequest.php:17`).
- **Effect:**
  - Tighten VAT-03's remediation to "S ∈ {15, 5}; Z/E/O = 0".
  - VAT-15's tax catalogue has an official domain to validate against (BR-KSA-84).
  - Ratings unchanged. The uncovered rate-domain gap is listed in section C.

##### 5. PH2-05 (P0): rule attribution
- **Stream claim:** "InvoiceTypeCode 381/383 (BR-KSA-17, BR-KSA-56)".
- **Register:**
  - The type-code list is governed by BR-KSA-05 (R2-002).
  - BR-KSA-17 is the **reason** rule (KSA-10, an error) and BR-KSA-56 is the **billing-reference** rule (BT-25). Both are in R2-022.
  - BR-KSA-56 is only a **warning** in the SDK, although the Data Dictionary marks BT-25 M for notes (R2 §3) and IR 54(4)–(5) requires the reference (R1-113).
- **Effect:** Citation fix. P0 unaffected, because notes are not produced at all.

##### 6. PH2-04 (P0): the mandatory list mixes error-level and warning-level elements
- **Stream claim:** The list includes "KSA-11/12 line TaxTotal/RoundingAmount (M for standard)", and also BT-29, the seller address, the standard-only buyer data and KSA-5 as mandatory.
- **Register:**
  - KSA-11 is M only for 01 documents, but **KSA-12 is M×6**: the Data Dictionary marks it mandatory for simplified documents too (R2 §3; R2-023).
  - BT-29 (BR-KSA-08), the seller address (BR-KSA-09/37/66), the buyer address and ID (BR-KSA-10/63/81) and KSA-5 (BR-KSA-15) are M or C in the Data Dictionary but **warnings** in the SDK. ZATCA returns seller-address findings as accepted-with-warnings (R2-014, R2-016, R2-017, R2-020; D6 §2.3.11).
- **Effect:**
  - P0 stands on the error-level failures: the XSD (`PartyTaxScheme` without `TaxScheme`), BR-CO-04/15/18, BR-KSA-68/39 and BR-KSA-52/53, all verified 18/18.
  - The remediation matrix should mark which elements cause rejection and which only warn, and add KSA-12 to simplified documents.

**Cross-slice pointers (not counted here):**
- **Stamp and QR claims** (PH2-01/02/03/06, PH1-14): GM6 #1, #2, #3 and #7.
- **VAT-04's "will fail" impact:** GM3 #9. R2-029 is the tolerance row.
- **PH1-16's "no bulk export" claim, and retention:** GM4 #4.
- **PH1-15's article:** GM2 #3. R2-036 confirms the Arabic requirement.
- **PH1-05's hard block on buyer data:** GM2 #4(c). BR-KSA-81 is a warning.
- **ACC-04** (not cited in GM5): its expected behaviour "issue date ≤ today (configurable tolerance)" conflicts with R2-008 / BR-KSA-04 (**error**: IssueDate ≤ current date). Once PH1-01/PH2-08 tie `IssueDate` to the issue moment, any tolerance that allows future dates produces rejected XML.

#### B. Register support that strengthens a stream position (not conflicts)

##### 1. Rows that confirm "[official-ref to confirm]" tags
- **PH2-08 / PH1-01:**
  - R2-008: `IssueDate`/`IssueTime` are mandatory; BR-KSA-04, BR-KSA-70 and BR-KSA-F-01 are **errors**; time is local KSA time, or UTC with `Z`.
  - R2-071: QR tag 3 = `IssueDate`+`T`+`IssueTime`.
  - R2-060: BR-KSA-98, the 24-hour reporting warning.
- **PH1-07 / PH2-12:** R2-070 says the TLV length is one byte holding the UTF-8 byte count, which confirms the 255-byte ceiling.
- **SUB-07:** R2-007 (a rejected document's UUID/ICV is never reused, D5 FAQ p.76) and R2-061 (a new UUID, ICV and hash after rejection).
- **VAT-02** (cross-slice; "[consolidator to confirm exact wording]"): the BR-KSA-56 wording is confirmed (R2-022, `rules-ksa.txt:198-199`). It is a warning in the SDK.
- **PH1-04:** R2-015 (BR-KSA-39 and BR-KSA-40 are errors). R2-015 also adds BR-CUSTOM-VALIDATION-01 (seller VAT ≠ buyer VAT, error), which AWJ lacks.
- **PH2-14** ("n/a — internal invariant"): R2-001 (the validation phases) and R2-064 (the SDK validates XSD, EN, KSA, QR, stamp and PIH offline; passing the SDK is close to passing the API) give an official basis for the SDK gate the finding recommends.

##### 2. Rows that support or extend a finding's position
- **PH2-10 / SUB-10 / SEC-06:** R2-010 (one sequence per EGS unit across standard and simplified documents; never reused; gaps investigated), together with R2-054 (independent environments). This matches GM6 B.
- **SUB-01 / SUB-04:** R2-012 (for standard documents ZATCA generates the QR at clearance) and R2-059.
- **CON-03:** R2-002 (386 is in the type list) and R2-031 (`PrepaidAmount` with prepayment lines KSA-26…34; three SDK samples).
- **PH2-13:** R2-003, R2-004 and R2-005 confirm each rule cited. Positions 8–9 (continuous supply, B2G) exist only in SDK 3.4.3+, not in the 2023 PDF. SDK 3.4.6 relaxed BR-KSA-31 for simplified exports (R2-004).
- **VAT-07:** R2-028 and R2-030 (half-up on the third decimal; round final results).
- **VAT-08:** R2-024 (a document charge carries its own category and rate). It also needs a reason code (BT-105, UNTDID 7161, BR-KSA-CL-06) and a reason text (BT-104, BR-KSA-19/21). VAT-08's remediation should add these.
- **ACC-06:** R2-022 (a note carries BT-25 and shares the subtype of the referenced invoice).

#### C. Gaps with no covering finding (new_gap rows in GM5_output.json, plus one found in this review)

| Row | Uncovered gap | Now covered by |
|---|---|---|
| R2-025 | Rate-domain validation: S must be 15 or 5 and Z/E/O must be 0 (BR-KSA-84, error); AWJ accepts any rate from 0 to 100 | **None.** No CON covers it. Fold it into the VAT-03 remediation. |
| R2-032 | Field lengths: item name 3–1000 characters (BR-KSA-F-06-C19; AWJ has an unbounded description with a '-' fallback); buyer city ≤ 127 (BT-52; AWJ allows 255) | **None** (low). Fold it into the PH2-04 remediation. |
| R2-035 | E-invoice file naming (D1 §14) | CON-09, which cites R2-035 |
| R2-037 | XML or PDF/A-3 (embedded XML) generation, storage and sharing | CON-09, which cites R2-037 and R1-038/070 |

**Additional uncovered gap found during this review (not flagged in the outputs):**
- **What happens:** A **positive** invoice `adjustment` is VAT-free consideration.
  - `StoreInvoiceRequest.php:38` accepts up to +100,000,000,000 halalas.
  - `InvoiceService.php:994-1001` credits it to `document_adjustment` with no output VAT.
- **What the register says:** Any amount that is consideration for the supply is taxable (R1-144, R1-140, GM3 slice). BT-114 only allows a *rounding* amount (R2-030).
- **Why no finding covers it:** VAT-06 covers only the XML representation of the adjustment. Stream A's matrix row 14 tested only a negative value.
- **Suggested policy:** limit `adjustment` to a rounding tolerance, or require larger values to be a categorised charge or allowance. The choice should be configurable, per CLAUDE.md rule 6.

#### D. Status corrections suggested

**None required.** The 37 statuses match the evidence. R2-006 and R2-034 (VERIFIED IMPLEMENTED) are confirmed by the official samples and the SDK runs.

**Findings-list and notes updates (no status change):**
1. **R2-035** and **R2-037:** add CON-09 and set `new_gap` to false.
2. **R2-021** (NOT APPLICABLE): NOT APPLICABLE is defensible against the technical row, where BT-81 is optional. Add a cross-reference:
   - to R1-097: payment means are mandatory on tax invoices from Phase 2 under Resolution Annex 2 row 9.1, rated NOT IMPLEMENTED in GM2;
   - to R2-022: `PaymentMeans/InstructionNote` is mandatory on notes.
   Without it, the inverted matrix would show payment means as carrying no obligation.
3. **R2-030:** add to `gap`/`notes` that AWJ's `adjustment` is not bounded to rounding, so it cannot be mapped to BT-114 as it stands (see A.2(d) and C).
4. **R2-006:** the note's reference to PH1-17 is confirmed. PH1-17's ProfileID item should be withdrawn (A.1).


## GM6

### GM6 conflicts — slice R2-040 … R2-073 (AWJ-TAX-ZATCA-AUDIT-1)

Compared: the "Official requirement" / "Expected behavior" text of every finding cited in this slice against register rows R2-040…R2-073. I also used the register's §7 (crypto parameters), §9 (pitfalls), §10 (API table) and §11 (unverified list), and the D3/D6 texts those rows cite (`<audit-workspace>/official/R2-work/text/sec-std-2023.txt`, `DEVELOPER-PORTAL-MANUAL.txt`).

Eight conflicts are listed in section A. Severity changes are suggestions only. The master file has not been edited.

#### A. Finding claims contradicted or unsupported by the register

##### 1. PH2-02 (P0): leaf-only certificate and "ZATCA profile" wording
- **Stream claim:** The ZATCA profile has SigningCertificate (v1) with IssuerSerial, no policy, no DataObjectFormat, and Reference Type `xmldsig#SignatureProperties`. Expected behaviour: "embed only the leaf certificate". The finding lists "full chain in KeyInfo" among the defects.
- **Register:** R2-042 notes and §9 P10 say D3 v1.2 §2.3.3 (the official Security Features standard) lists SigningCertificateV2, SignaturePolicyIdentifier (cardinality 1), DataObjectFormat/MimeType and Type `http://uri.etsi.org/01903#SignedProperties`. None of these appear in the SDK template or samples, and the register designates the SDK as operative.
- **Register on the chain:** R2-046 cites D3 req 17: "the full chain of certificates from the signing certificate up to ZATCA's trust anchor shall be included in the signature". D3 §2.3.3 item 1.5.1 says the same for X509Data. Only the SDK samples carry the leaf alone.
- **Register on SigningTime:** R2-042 notes record the "no zone" format only as what the samples show. It is not a validated rule.
- **Assessment:** AWJ's builder implements D3 §2.3.3 literally.
  - The core of PH2-02 holds against the operative SDK: the SDK XSD lacks SigningCertificateV2, so XSD failure is certain, and IssuerSerial is missing.
  - The digest-encoding parts also hold, but they rest on the SDK, not on the R2-042 structure row: R2-043/R2-044 (reproduced 19/19).
  - The sub-claims "full chain in KeyInfo is a defect / embed only the leaf" and "SigningTime must have no zone" are not supported by any official text. They are SDK-sample conventions, and D3 req 17 contradicts leaf-only.
  - P0 is unaffected. The finding should say that D3 and the SDK diverge, and should not require leaf-only unless the SDK or platform is shown to reject a chain. That is NOT VERIFIED.

##### 2. PH2-06 (P1): "ZATCA's profile does not have" a policy; "no official value"; "fabricated policy"
- **Stream claim:** The ZATCA stamp profile contains no `xades:SignaturePolicyIdentifier`. "There is no official value an operator could pin, so the only way to post is to invent an identifier and digest."
- **Register:** R2-042 notes say D3 §2.3.3 lists SignaturePolicyIdentifier with cardinality 1. D3 item 1.6.2.1.1.3 reads: "shall contain … an explicit identifier of a signature policy (this document)". So D3 names itself as the policy, and the register's inventory gives D3's URL and SHA-256.
  - Supporting the finding: the SDK template and samples have no policy element (R2-042; §9 P10), and D3 req 15 says level B-B (R2-046).
  - D's own text says "XSD allows it but the validator never reads it".
- **Assessment:**
  - "No official value" and "fabricated" are contradicted. An operator can pin D3's URL and digest, which is what `config/zatca.php:25-29` asks for.
  - The regulatory impact is weak, because the element passes the XSD and the SDK ignores it.
  - The operational impact stands: with any credential row present and the environment variables unset, every posting fails tenant-wide.
- **Suggested rating:** P1 is defensible only on availability grounds. P2 would match the evidence better.

##### 3. PH2-01 (P0): requirement attributed to the Security Features standard
- **Stream claim:** "Security Features Implementation Standard — digital signature = ECDSA (secp256k1, SHA-256) over the invoice hash".
- **Register:** No row states what is signed. R2-041, R2-042 and §7 only fix the algorithm and require "SignatureValue base64 DER ECDSA". D3 §2.3.3 items 1.1/1.2 describe standard XMLDSig, where canonicalisation is "applied to the SignedInfo element prior to performing signature calculations". That is exactly what AWJ does.
- **Assessment:**
  - The attribution to the standard is unsupported; the standard's own wording supports AWJ's input.
  - The finding is still correct against the operative SDK. The SDK bytecode, and D's V1 check that the official samples verify over the raw hash bytes rather than SignedInfo, show this. The DER-versus-raw part is directly supported by R2-042.
  - P0 is unaffected. The requirement should be re-cited as SDK/sample-derived.

##### 4. SUB-03 (P1): `Clearance-Status` header presented as part of the official contract
- **Stream claim:** The request contract diverges from the official one: there is no `uuid` in the body and no `Clearance-Status` header for clearance.
- **Register:**
  - R2-055 notes and §11 say the `Clearance-Status: 1` header is **RECALLED-UNVERIFIED** (not in any obtained document).
  - R2-056 supports `uuid`, because the SDK `-invoiceRequest` emits it. But D6 FAQ Q3/Q7 shows a two-key body.
- **Assessment:** The header half is unsupported. The `uuid` half is supported as a divergence from the SDK, but live enforcement is unverified. P1 rests on "probable 400 if uuid is enforced". Keep the finding on `uuid` and mark the header as unverified.

##### 5. SUB-06 (P2): duplicate after timeout is "rejected although ZATCA holds it"
- **Stream claim:** Retry re-sends the identical document with no reconciliation, and "a 400 on the duplicate would record the invoice as `rejected` although ZATCA holds it".
- **Register:**
  - R2-061: "Duplicate submission is not rejected by the API but ZATCA counts the invoice once (UUID + hash)".
  - R2-057: 429/500/503/504 mean resend (document not received). §9 P13 agrees.
  - The FAQ that E itself quotes says a duplicate "will not be rejected at the time of submission".
- **Assessment:**
  - The false-rejection premise is contradicted, and re-sending the same document after a transport failure is the documented behaviour.
  - Still valid: transfer/TLS exceptions are recorded as non-retryable `submission_preflight_failed` (probe P05), and there is no explicit in-doubt state for audit.
- **Suggested rating:** P2 → P3.
- **Related, SUB-09 (P2):** its regulatory impact ("lost acceptances ⇒ duplicate submissions") is likewise mitigated by R2-061. Its P2 remains defensible on the separate ground of a row lock held during an HTTP call of up to 35 s.

##### 6. SUB-02 (P1): "200 {reportingStatus: NOT_REPORTED} ⇒ accepted" and the status values in the expected behaviour
- **Stream claim:** Acceptance should require `reportingStatus=REPORTED`, `clearanceStatus=CLEARED` and a parseable `clearedInvoice`. AWJ accepts a 200 that carries NOT_REPORTED.
- **Register:**
  - R2-057 (D4 p.52, D6 Q9/Q10): 200 = accepted, 202 = accepted with warnings, rejection = 400. No source documents a 200 that carries NOT_REPORTED.
  - R2-061, R2-062 and §11: only `NOT_REPORTED` is evidenced. `REPORTED`, `CLEARED`, `clearedInvoice` and `validationResults` are RECALLED-UNVERIFIED.
- **Assessment:**
  - Unsupported: the 200+NOT_REPORTED scenario, and a fix keyed on those status values.
  - Supported: 303 is a documented code (R2-057), so following redirects or mis-recording 303 is a real risk. Accepting a non-JSON 200 is a weak hygiene issue.
  - TLS verification is on (E PC-3), so the "captive portal/WAF" scenario needs a TLS-intercepting proxy.
- **Suggested rating:** P1 is arguable; P2 would also be defensible. In this matrix, SUB-02 is not used as evidence for R2-058 or R2-061.

##### 7. PH2-03 (P0) vs PH1-14 (P3): QR tag-3 format
- **Stream claims:** PH2-03 expects tag 3 as `yyyy-MM-dd'T'HH:mm:ss` with no `Z`. PH1-14 expects "one canonical UTC `Z` format for both phases".
- **Register:**
  - R2-071: samples have no `Z`, but the D3/D5 examples include `Z`.
  - R2-008: IssueTime may be `hh:mm:ss` or `hh:mm:ssZ`.
  - The operative SDK check is that tag 3 equals the XML IssueDate + 'T' + IssueTime as text.
- **Assessment:** Neither format is mandatory on its own, and the two findings prescribe opposite formats. Both ratings stand, because the real defect is the QR/XML mismatch and the draft-time source. Remediation should be unified on "tag 3 == XML IssueDate+'T'+IssueTime".

##### 8. PH2-09 (P1): "six compliance documents" (minor)
- **Register R2-052:** The compliance set depends on the functionality map. 1000 means standard invoice, debit and credit; 0100 means the three simplified documents; only 1100 means all six.
- **Assessment:** Minor imprecision; the rating is unaffected.

#### B. Register support that strengthens a stream position (not conflicts)
- **SUB-10 / PH2-10 / SEC-06:** SUB-10 lists its requirement as NOT VERIFIED. Its issue is one ICV/PIH chain spanning simulation and production. R2-054 says simulation and production are independent environments with separate onboarding, and R2-010 requires one sequence per EGS unit. Together they partly support segregating the chains, though no row says so explicitly.
- **SEC-03** ("CSID renewal is a routine lifecycle event [official-ref to confirm]"): confirmed by R2-053 (renewal flow; the portal sends expiry reminders).
- **SUB-11** ("401 = credential problem [official-ref to confirm]"): confirmed by R2-057 (401 means check CSID/secret; 413 means payload too large; 303 means clearance-state routing).

#### C. Gaps with no covering finding (reported in GM6_output.json)
- **R2-047 (`new_gap: true`):** AWJ makes no CRL/OCSP revocation check before stamping and never refreshes a CRL. D3 v1.2 §2.2.1 req 14 says: "Before using the certificate for stamping, EGS … shall check certificate's validity against" CRL/OCSP.
  - Evidence: a grep for `crl|ocsp|revoc|revok` over app/, config/, routes/, database/ and web/src finds nothing ZATCA-related. `ZatcaSigningCredentialResolver.php:36-38` checks expiry only.
  - Adjacent findings that do not name it: PH2-09 (no revocation lifecycle) and OPS-03 (shallow readiness).
- **R2-042 (minor, fold into PH2-02):** `ZatcaXmlDsigSignedInfoBuilder.php:79-81` adds a c14n11 `ds:Transforms` to the SignedProperties reference. It is absent from the SDK template and samples, and the SDK did not flag it.
