# TAX-HZ-00 — Accounting-platform UX benchmark (ZATCA e-invoicing)

> **Status:** documentation-only research input. No UI was built, no product account was created or used, no ZATCA API was called, no tracked file was edited.
> **Date of research:** 2026-10-13 · **Branch:** `claude/tax-hz-00-zatca-evidence-pass`
>
> **Standing caveat (read first).** Everything in this file about competitors is **design evidence only**. A competitor's behaviour is **never** a ZATCA requirement, never evidence of what ZATCA accepts, and never an AWJ decision. Where a competitor claims a regulatory rule (deadlines, reason codes, field limits) the claim is recorded as the vendor's claim and is unverified. Every item in section 5 is a **recommendation, not a decision**; decisions belong to the owner and to the ADRs named in `docs/audits/AWJ-TAX-ZATCA-REMEDIATION-PLAN.md`.

---

## 1. Method and access limits

**What was done.** Public help centers, public documentation, public blog pages, public GitHub source and public official ZATCA PDFs were fetched with `WebFetch`, `WebSearch` and `curl` through the session proxy. No login, no sign-up, no demo-account request, no API call to ZATCA, no form submission. All fetched content was treated as untrusted data.

**Visual vs text observation.**

| Mode | What it covers |
|---|---|
| **Visual (screenshot/image actually opened and looked at)** | Official ZATCA *Fatoora Portal User Manual v3* (May 2023): pages 6, 11, 14 rendered locally from the PDF (OTP request page, "View List Of Solutions And Devices", "E-invoicing statistics"). Zoho Books help images `enter-otp.png`, `push.png`, `role.png`. Daftra help images (Apps Manager toggle, "Electronic Invoice Settings" form, "Not Submitted" and "Valid" invoice headers). |
| **Text-only** | Everything else: Odoo, Qoyod, Wafeq, Foodics, ERPNext-app (source code), Zoho text, Daftra text, ZATCA Simplified Guide. Text was read from the page body, not from marketing snippets, unless stated "search snippet". |
| **Not done** | No headless-browser screenshots (Playwright is not installed for Python; Chromium exists but was not needed because the documentation images could be fetched directly). No YouTube transcripts were attempted. **No Arabic/RTL competitor screens were seen** — every screenshot examined is an English LTR UI (the official portal screenshots show an Arabic/English toggle but the rendered pages are English). RTL conclusions in this file therefore come from AWJ's own rules, not from competitor evidence. |

**Platform reachability summary.**

| Platform | Reached? | Depth |
|---|---|---|
| ZATCA Fatoora portal manual (official) | Yes | Full text + 3 screenshots |
| Daftra (docs.daftra.com) | Yes | 9 English articles + 4 screenshots; Arabic index |
| Odoo (official docs 18.0 and 19.0 "Saudi Arabia") | Yes | Full text (no screenshots found in page) |
| Zoho Books (help "Phase-2 e-Invoicing", academy FAQ) | Yes | Full text + 3 screenshots |
| Qoyod (qoyod.com KB / learn) | Partly | 4 pages read via WebFetch (direct `curl` returned 403); some via search snippet only |
| Wafeq | Partly | Public blog pages read; **help-center articles returned 403** (only search snippets) |
| ERPNext / Frappe | Partly | **Not the official ERPNext core.** Third-party open-source app `ERPGulf/zatca_erpgulf` (README + `hooks.py` + JS) and the Claudion docs index. Official frappe/erpnext KSA Phase-2 docs: NOT OBSERVED |
| Foodics | Partly | One public blog page (dated 2022-12-27); help-center article returned 403 |
| Salla | **No** | `docs.salla.dev` home reachable but has no ZATCA content; help center is not indexable. **NOT OBSERVED** |
| Zid | **No** | Help center / blog not retrievable (blog URL redirected to a generic blog index). **NOT OBSERVED** |
| Rewaa | **No** | No public help-center page found. **NOT OBSERVED** |

---

## 2. Source / observation register

Confidence: **H** = read from the page body of an official or first-party product page; **M** = first-party page but dated, partial, or contradicts another page of the same vendor; **L** = marketing copy, search snippet, vendor blog making regulatory claims, or third-party app.

| # | Platform | URL | Page title (as fetched) | What was observed | Date shown | Conf. |
|---|---|---|---|---|---|---|
| O1 | ZATCA (official) | `https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/Fatoora_Portal_User_Manual_English.pdf` | "FATOORA Portal User Manual – Version 3" | Portal menu: "onboard new solution unit/device", "Renewing Existing Cryptographic Stamp Identifier (CSID)", "View list of solutions and devices", "E-invoicing statistics", "API Documentation". OTP valid 1 hour, copy or download as file; up to 100 codes per request (small print in the low-resolution screenshot; Qoyod Q1 also states 1 to 100); reCAPTCHA on simulation portal; revoke needs a confirmation and is irreversible; Fatoora and Simulation are two independent environments. Device list columns and filters (screenshot). Statistics split into "Accepted documents / Accepted documents with warnings / Rejected documents" with detailed CSV on request. Header toolbar with contrast toggle, A-/A+ font size, Arabic toggle (screenshot). | May 2023 (PDF created 2023-06-07) | H |
| O2 | ZATCA (official) | `https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/Simplified%20guide_En.pdf` | "Simplified guide" | Simplified invoice process diagram: seller "reports the e-invoice to ZATCA within a maximum duration of 24 hours"; tax-invoice process: shared with ZATCA, "cleared ... and sent back to the taxpayer after the clearance". | 2022-06 (PDF metadata) | H |
| D1 | Daftra | `https://docs.daftra.com/en/user_manual/enabling-the-direct-integration-for-the-second-phase-with-zatca/` | "Enabling the Direct Integration for the Second Phase with ZATCA – Daftra Knowledge Base" | Enable "KSA Electronic Invoice" in Settings > Apps Manager; Sales > Sales Settings > "Electronic Invoice Settings" card with two cards "Fatoora Simulation" and "Fatoora Portal"; "Activate"; all fields prefilled except OTP; warns to use the device-registration OTP not the login OTP; Simulation card disappears after production integration. | none shown | H |
| D2 | Daftra | `https://docs.daftra.com/en/user_manual/integrating-with-the-electronic-invoice-phase-2/` | "Integrating with the Electronic Invoice (Phase 2) and sending the invoices to ZATCA – Daftra Knowledge Base" | Invoice header "E-Invoice" badge: "Not Submitted" then "Valid" or "Invalid"; button "Send To E.Invoice" (disabled after Valid); automatic resend on server error, manual correction on data error; not available on Free plan; each branch integrated separately. Screenshots viewed (2024-02/03 uploads). **Internal inconsistency:** this page says the OTP is "valid for only one minute"; D3 and the official manual say one hour. | screenshots uploaded 2024-02/03 | M |
| D3 | Daftra | `https://docs.daftra.com/en/user_manual/troubleshooting-issues-when-linking-your-daftra-account-with-fatora-platform/` | "Troubleshooting Issues When Linking Your Daftra Account with Fatora Platform" | Table "Message / Explanation / Solution": e.g. "The csr organization identifier format is invalid." (VAT must be exactly 15 characters), "Invalid-OTP" (incorrect, expired >1 hour, or already used), "NOT_COMPLIANT" (company name must match the commercial registration), "The document issue date must be less or equal to the current date". | none shown | H |
| D4 | Daftra | `https://docs.daftra.com/en/tutorial/validating-client-data-before-sending-an-invoice-to-zatca/` | "Validating Client Data Before Sending an Invoice to ZATCA – Daftra Knowledge Base" | Ordered pre-submission validation (client type → identification → address format only if provided → edit restrictions → submit); POS invoice always saved even if buyer data is insufficient, with a shortcut to the client edit page; bulk-import rows failing validation are not submitted; after success, edits that would invalidate the document are blocked; ZATCA warnings shown on the invoice, bilingual, "from 12 July 2026 onward". | 2026 (mentions 12 July 2026) | H |
| D5 | Daftra | `https://docs.daftra.com/en/tutorial/zatca-warnings-on-valid-invoices/` and `.../faq/why-does-a-warning-appear-even-though-the-invoice-was-accepted/` | "ZATCA Warnings on Valid Invoices" / "Why does a warning appear even though the invoice was accepted?" | Warnings are displayed on the invoice view page in Arabic and English with a note that the invoice is valid and the text comes from the ZATCA portal; "no action is required"; warnings do not change the invoice status. | 2026 | H |
| D6 | Daftra | `https://docs.daftra.com/en/tutorial/displaying-the-list-of-e-invoices-by-status/` | "Displaying the List of E-Invoices by Status" | Sales > Invoices Management > "Advanced Search" > "Electronic Invoice Status" (example values "Submitted – Valid – Rejected"); same filter on the "Refund Receipts" screen for returns. | none shown | H |
| D7 | Daftra | `https://docs.daftra.com/en/tutorial/deleting-and-editing-electronic-invoices/` | "Deleting and Editing Electronic Invoices" | Invoices cannot be edited/deleted once e-invoicing is active; drafts can; reversal = "Create Credit Note" or "Create Refund Receipt" from the invoice ("More Options"); refund receipt table is pre-filled from the original invoice, rows removed with "-"; original shows "Refunded"; a Daftra deletion does not delete it from Fatoora. Also describes deactivating the e-invoice app during a trial to restore edit/delete. | none shown | H |
| D8 | Daftra | `https://docs.daftra.com/en/tutorial/how-to-add-the-qr-code-to-the-invoice/` | "How to add the QR Code to the Invoice" | QR appears automatically on sales invoices; not on drafts or pre-save preview; template variable `{%sa_qr_code_image%}`. | none shown | H |
| D9 | Daftra | `https://docs.daftra.com/category/.../الفاتورة-الإلكترونية-السعودية/` | Saudi e-invoice category index (Arabic) | Article titles only: ZATCA alerts on valid invoices, client data requirements, national/short address, "مسح وتعديل الفواتير الإلكترونية", list by status, "Show branch name in the QR". | none shown | H (titles) |
| OD1 | Odoo | `https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations/saudi_arabia.html` | "Saudi Arabia — Odoo 19.0 documentation" | Three modes **Sandbox / Simulation (Pre-Production) / Production** via Accounting > Configuration > Settings "ZATCA API mode"; per-sales-journal "ZATCA" tab > "Onboard" > "Enter the OTP" window (6 digits); after confirm a blue banner with "Process now"; response code table (200, 202, 303, 400, 401, 413, 429, 500, 503, 504 each with an action); chatter message colours green/yellow/red; "Retry" after fixing; rejected stays "Rejected" and "not legally valid"; example rule code message `BR-KSA-F-13`; credit/debit note "ZATCA Reason" field with five reasons, "Customer Reference" for unrelated notes; XML and PDF permanently attached in chatter and not deletable; "PDF/A-3 with the embedded UBL 2.1" via Send; Production switch cannot be reverted after a submission; revoke in Fatoora portal. | none shown | H |
| OD2 | Odoo | `https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations/saudi_arabia.html` | "Saudi Arabia — Odoo 18.0 documentation" | "Regenerate CSR" if onboarding fails; unprocessed invoices sent automatically at end of each day; only rejected invoices can be reset to draft; 0% tax needs "Exemption Reason Code" under the tax's Advanced Options. | none shown | H |
| Z1 | Zoho Books | `https://www.zoho.com/sa/books/help/e-invoicing/phase-2.html` | "Phase-2 e-Invoicing" | Prerequisites (Arabic names/addresses for standard invoices); onboarding via OTP → "Generate CSID"; one-hour OTP warning; "Renew CSID" and "Disconnect" under Settings > Taxes & Compliance > e-Invoicing; role permission e-Invoicing > "Push Transactions"; statuses "Yet-to-be Pushed / Push Initiated / Pushed / Failed"; per-invoice "Push to Fatoora" button; recurring-invoice and quote preferences (create as draft vs create-push-send); standard pushed before sending, simplified within 24 hours; PDF "exported in A3 format" with XML attached; retry after rectifying. Three screenshots viewed: "Enter OTP and Generate CSID" modal with a prerequisites box; invoice page with "Push to Fatoora" card and "Push Status: Ready To Be Pushed — Pushed" stepper; "New Role" with "Push Transactions" checkbox. | none shown | H |
| Z2 | Zoho Books Academy | `https://www.zoho.com/books/academy/sa/taxes-and-compliance/zatca-e-invoicing-phase-2.html` | "FAQs about e-invoicing Phase 2 in Saudi Arabia" | Regulatory FAQ (waves, invoice types, 24-hour report). Contains wave dates that conflict with another Zoho page (search result) — not used for UX. | 2024-12-11 | M |
| Q1 | Qoyod | `https://www.qoyod.com/en/knowledge-base/how-to-connect-qoyod-with-zatca-via-fatoora-portal-phase-2-e/` | "How to Connect Qoyod with ZATCA via Fatoora Portal: Phase 2 E-Invoicing, Verification Codes, and Troubleshooting" | Settings > Electronic Integration > Fatoora Portal > "Start Integration"; code typed digit by digit, **pasting not allowed**; "Save"; enabled icon on success; older invoices show "Not Applicable"; errors "An error occurred, please try again", "Exceed Character Limit" (expired code), "You do not have permission to access", status "Processing". | footer © 2026 | M |
| Q2 | Qoyod | `https://www.qoyod.com/en/knowledge-base/guide-to-e-invoice-statuses-after-zatca-submission-alerts-re/` | "E-Invoice Statuses After ZATCA: Alerts \| Qoyod Help Center" | Statuses "Sending/Processing", "Not applicable", green "Successfully received", yellow "Received with alerts", red "Rejected"; buttons "View" and "Resubmit to ZATCA" (only on new invoices with "Not applicable"); rejected invoices cannot be edited or resubmitted, fix is a credit note then a new invoice; standard-invoice "invoice error" auto-creates and links a credit note; "Any user who can view invoices can see alerts and errors. No separate e-invoicing permission is required." | footer © 2026 | M |
| Q3 | Qoyod | `https://www.qoyod.com/en/learn/rejected-invoices/` | "Rejected Invoices and Reasons for Rejection" | "Error Center" listing numbers 1001–1020 (Qoyod's own numbering, not ZATCA codes) next to genuine rule codes (BR-CO-15, BR-KSA-26, BR-KSA-39, BR-KSA-60, BR-KSA-70, BR-KSA-08); API-style statuses CLEARED/NOT_CLEARED; developer flow "Detect NOT_CLEARED → Read errorMessages → Correct → new ICV and UUID → Resubmit". **Conflicts with Q2** (credit-note route vs. correct-and-resubmit). | footer © 2026 | L |
| Q4 | Qoyod | `https://www.qoyod.com/en/learn/credit-notes-tech/` | "Credit Notes (381) in ZATCA E-Invoicing: A Technical Reference" | Credit note started from the original invoice list; full return / specific lines / discount value; BillingReference filled automatically; no "Delete" for cleared invoices; type/UUID/ICV/PIH set by the system. Vendor's own description, "not verified against the product". | footer © 2026 | L |
| Q5 | Qoyod | `https://www.qoyod.com/en/learn/linking-with-zatca/` | "Integration with ZATCA: How E-Invoicing Linkage Works" | Explanatory six-step article: Cleared / Reported / Rejected definitions; each issuing unit has its own CSID. No screens. | footer © 2026 | L |
| W1 | Wafeq | `https://www.wafeq.com/en-sa/tax-and-reporting/zatca-phase-2-integration:-5-steps-to-avoid-onboarding-errors` | "Zatca Phase 2 Integration: 5 Steps to Avoid Onboarding Errors" | Blog: onboarding interface "guides you through the single input that requires action from you: the OTP"; private key generated in vendor vault; 60-minute OTP; simulation and 12 compliance scenarios. Marketing-technical, no screens. | "Last updated Tuesday, June 9, 2026" | L |
| W2 | Wafeq | `https://www.wafeq.com/en-sa/tax-and-reporting/how-to-handle-credit-notes-in-ksa-e-invoicing` | "How to handle credit notes in KSA e-invoicing" | Vendor regulatory explainer (type 381, BillingReference, "15 calendar days" rule, five reasons). Regulatory claims **unverified**; no UI. | "Last updated Friday, July 17, 2026" | L |
| W3 | Wafeq | help.wafeq.com articles ("Finalized invoices in Wafeq", "How to get Clearance for an invoice on the Fatoora platform") | — | HTTP 403 for both `curl` and `WebFetch`. Only search-engine snippets (status label "Finalized"; auto-submit after finalising). **NOT OBSERVED.** | — | L |
| E1 | ERPNext (third-party app) | `https://raw.githubusercontent.com/ERPGulf/zatca_erpgulf/main/README.md` | README "Saudi Arabian E-Invoicing (ZATCA Phase-2) – A Frappe ERPNext App" | Feature list incl. automatic CSR generation, "Logging for audit trails & error handling", "Reports to compare invoices with ZATCA portal statistics"; Company → ZATCA Settings checkbox "Allow Credit-note without Original Invoice in the System" and field "Return Against for ZATCA"; Sales Invoice checkboxes "Skip Validation for Credit Note" and "ZATCA PMM (Profit Margin Method)". | none shown | M |
| E2 | ERPNext (third-party app) | `.../zatca_erpgulf/hooks.py`, `.../public/js/company.js`, `.../public/js/resubmit.js`, `.../public/js/badge.js` | source files | Cron every 30 minutes to submit pending invoices; Company form buttons for create CSR, generate compliance CSID, generate production CSID with a "portal type" select; Sales Invoice list-view bulk action "Send Invoices to ZATCA" / "Resubmit failed invoices" (the older variant is commented out in `resubmit.js`); status values "Not Submitted / Cleared / Reported / Cleared with Warnings / Reported with Warnings" (in `badge.js`, **currently commented out** in main). | none shown | M |
| E3 | Claudion (ERPNext vendor docs) | `https://docs.claudion.com/Claudion-Docs/ErrorMessage1` | "CSR Creation Failed" | Navigation index of a "Zatca Phase-2 Error Messages" section (titles only: CSR creation failed, invalid OTP, CSID certificate/OTP validation failed, invalid tax category code, certificate permissions, VAT/total errors, billing reference issues, UBL 2.1 schema violation, PIH across devices …) and "ZATCA ERPgulf Event Log – API Response Handling". Bodies not read. | none shown | L |
| E4 | ERPNext marketplace vendor | `https://ecosire.com/apps/erpnext/erpnext-ksa-zatca-phase2-einvoicing` | (search snippet only) | Marketing claims of role separation, environment switch guard. **Not fetched; treated as unverified.** | — | L |
| F1 | Foodics | `https://www.foodics.com/zatca-phase-2/` | "Steps for Activating E-Fatoora for ZATCA's Phase 2 – Foodics" | POS dashboard: Manage > Settings > add Commercial Registration No > Save Changes; per-branch: Manage > Branches > Edit Branch; OTP generated on the ZATCA portal; "the cashier app will attempt to activate the integration ... success message ... otherwise an error message"; closed/returned orders sent after activation. Old and thin. | 2022-12-27 | M |
| F2 | Foodics Accounting | `help.foodics.com/hc/en-us/articles/22069927526300-...` | — | HTTP 403. Only a search snippet ("enter the 6-digit OTP code, then click Confirm"). **NOT OBSERVED.** | — | L |
| S1 | Salla | `https://docs.salla.dev/` | "Get Started" | No ZATCA/Fatoora content on the page. **NOT OBSERVED** for any ZATCA UX. | — | — |
| S2 | Zid | `help.zid.sa`, `blog.zid.sa/?p=6816` | — | Not retrievable (generic blog index). Search snippet only says Zid and Zid Cashier "issue simplified tax invoices that follow ZATCA rules". **NOT OBSERVED.** | — | L |
| R1 | Rewaa | — | — | No public help page found. **NOT OBSERVED.** | — | — |

---

## 3. Pattern comparison matrix (10 topics)

Column **Status** values: `official-UI` = shown by ZATCA's own portal manual (still only a *UI* reference, not a requirement on third-party solutions beyond what the Authority's documents say); `inspiration` = competitor pattern worth considering; `unresolved` = needs an AWJ decision, an ADR, or evidence we do not have.

### 3.1 EGS / device onboarding (OTP, CSR, device list, environment)

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| ZATCA Fatoora portal (O1) | Menu items "onboard new solution unit/device", "Renewing Existing CSID", "View list of solutions and devices", "E-invoicing statistics". OTP page asks "number of OTP codes"; OTP valid 1 hour, copy or download. Device list (screenshot): filters Search, Status, Onboarding Date, Certificate Expiry Date, Revocation Date, buttons "Filter"/"Reset"/"Download List"; columns Common Name, Serial Number, VAT Number, Organization Unit Name, Organization Name, Country Name, Status (`ACTIVE`), Onboarding Date, Certificate Expiry Date, Revocation Date, Revoke CSID (checkbox). Revocation asks for confirmation; irreversible, device can be onboarded again as new. Fatoora and Simulation are independent environments; devices onboarded separately. | Mirror the **information model** of the device list in AWJ's own table (serial, VAT number, status, onboarded, expiry, revoked) so a taxpayer can compare AWJ's list with the Authority's. Copy: "OTP valid for 1 hour" and "revocation cannot be undone" as helper text. Do not imitate the portal's look or branding. | official-UI |
| Daftra (D1) | Gated by enabling the "KSA Electronic Invoice" app, then two cards "Fatoora Simulation" and "Fatoora Portal", "Activate", prefilled form, single OTP field with explicit "device-registration OTP, not the login OTP" warning (screenshot: "Electronic Invoice Settings" form with Common Name, VAT Number, Branch Name or Vat Group, Organization Name, Country Code, Address, Industry Business Category, OTP). Simulation card removed after production integration. | Two-card environment choice, prefilled identity fields, a single required OTP input, and an explicit "which OTP" warning. AWJ already gates by application `compliance.zatca`. | inspiration |
| Odoo (OD1/OD2) | Environment is a system setting with three modes (Sandbox / Simulation / Production); onboarding is a button per sales journal with an OTP dialog; "Regenerate CSR" on failure; "Simulation ... invoices are not legally valid"; production mode cannot be switched back once an invoice was submitted; revoke done in Fatoora portal. | Per-unit "Onboard" action with OTP dialog; explicit "not legally valid" label in non-production; one-way production switch warning. **Per-journal onboarding** maps to a possible per-branch/per-EGS model in AWJ — see open decision U6. | inspiration |
| Zoho Books (Z1) | Modal "Enter OTP and Generate CSID" with a **prerequisites box** (TRN starts/ends with 3; company label prefix; building number 4 digits; additional number 4 digits; postal code 5 digits) and buttons "Generate CSID"/"Cancel" (screenshot). "Renew CSID" and "Disconnect" under Settings > Taxes & Compliance > e-Invoicing; renewal started in the Fatoora portal first. | Show a **readiness checklist inside the onboarding dialog** that lists the exact data fields that will be rejected, linking each to its settings page. Renew/disconnect as explicit actions with confirmation. | inspiration |
| Qoyod (Q1) | Settings > Electronic Integration > Fatoora Portal > "Start Integration"; code must be typed manually (pasting disabled); a "Processing" state after Save; "enabled" icon on success. | Linear start-integration entry point. **Do not** disable paste (see section 6). | inspiration (partly rejected) |
| Wafeq (W1) | Claims onboarding interface collapses CSR/keys/compliance steps into one OTP input; private key never leaves vendor vault. | Supports the principle "operator never touches key material" already encoded in REM-19. No screen evidence. | inspiration (L) |
| ERPNext app (E2) | Company form has three separate buttons (create CSR, compliance CSID, production CSID) and a "portal type" select — a **manual, step-per-button** onboarding. | Counter-example for AWJ: exposes the protocol steps to the user. Use only as a map of the underlying states for the wizard's step list. | inspiration (counter-example) |
| Foodics (F1) | Business data (CR number) entered per branch; OTP entered "on your own EGS unit(s)"; the cashier app attempts activation and shows success or error. | Confirms a multi-branch setup asks for branch-level identifiers before the OTP step. | inspiration (M, 2022) |
| Salla / Zid / Rewaa | — | — | unresolved (NOT OBSERVED) |

### 3.2 Tax settings, VAT category and exemption reason

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| Odoo (OD2, OD1) | 0% tax needs an "Exemption Reason Code" chosen in the tax's Advanced Options; a pre-configured "0% (Not Subject to VAT)" tax "already configured according to ZATCA rules; do not modify it"; company record required fields list (max 63 chars name, district, building number, plot id, identification scheme, VAT number, currency SAR); branch contact uses parent VAT number plus branch CRN. | Category + reason chosen **on the tax/rate definition**, not typed on every line; system-provided locked defaults for zero/exempt/out-of-scope; a company-identity completeness panel. Maps to REM-12 (category/reason model) and REM-14 (seller data). | inspiration |
| Zoho (Z1 screenshot) | Identity prerequisites surfaced where they matter (OTP modal), not only in settings. | See 3.1. | inspiration |
| Daftra (D4) | Customer type (business/individual) decides required identifiers; "VAT number OR commercial registration" for business; National ID or TIN for individual. | Buyer-data rules driven by customer type with inline explanation; the exact rule set is Compliance's call (REM-14/15). | inspiration; rule content `unresolved` |
| Qoyod, Zoho, Daftra | Tax-category / exemption-reason setup screens | **NOT OBSERVED** in the fetched pages | unresolved |

### 3.3 Invoice-level ZATCA status badges

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| ZATCA portal (O1, screenshot p.14) | Statistics donuts per channel in three buckets: "Accepted documents", "Accepted documents with warnings", "Rejected documents" (green / yellow / red). | Use the Authority's three-bucket vocabulary for **outcome**, so AWJ counts can be reconciled with the portal. | official-UI |
| Daftra (D2, screenshots) | Header line "E.Invoice:" + coloured badge "Not Submitted" (grey) → "Valid" (green) / "Invalid"; the "Send To E.Invoice" button is disabled once Valid; warning box (orange, text blurred in the image) under the header. | Badge in the invoice header next to payment/lifecycle state; action button disabled with reason when the state forbids it. | inspiration |
| Zoho (Z1 screenshot) | Card "Push to Fatoora — Push the invoice to the Fatoora portal to generate the QR code" and a **stepper** "Push Status: Ready To Be Pushed — Pushed"; text statuses Yet-to-be Pushed / Push Initiated / Pushed / Failed. | Stepper form for the in-flight states; but Zoho's vocabulary describes the **transport**, not the **ZATCA outcome** (no cleared/reported/warning distinction). | inspiration (partly counter-example) |
| Odoo (OD1) | Result is a coloured chatter message: green accepted, yellow accepted with warnings (legally valid), red rejected (not legally valid). | Three-colour outcome **plus icon and text** (AWJ rule: not colour alone). | inspiration |
| Qoyod (Q2) | "Sending/Processing", "Not applicable" (legacy), green "Successfully received", yellow "Received with alerts", red "Rejected". Explicit "legacy invoice" state. | A neutral "not applicable" state for documents issued before e-invoicing went live. | inspiration |
| ERPNext app (E2) | Status field values `Not Submitted / Cleared / Reported / Cleared with Warnings / Reported with Warnings` — clearance vs reporting are visible in the label. | Keep **clearance vs reporting** visible (standard vs simplified) rather than one generic "accepted". | inspiration |
| AWJ gap | Backend attempt statuses today: `pending`, `accepted`, `rejected`, `failed` (`ZatcaSubmissionService.php:99`). The REM plan adds in-doubt (REM-22) and a lifecycle gate (REM-24). | See R1/R2 in section 5. | unresolved (taxonomy + Arabic labels = decision U1) |

### 3.4 Validation feedback before issuing; error → human message; fix and resubmit

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| Daftra (D4) | Fixed, documented **order** of checks (client type → identifiers → address format only if provided → edit restrictions → submit); POS sale is never blocked, it is saved and flagged with a shortcut to the client edit page; import rows failing validation are skipped, not submitted; address normalisation removes hidden directional characters before sending. | Pre-issue checklist grouped by who can fix it; never lose a POS sale; link each failure to the field. | inspiration |
| Daftra (D3) | Documentation table maps raw messages (CSR/OTP/issue-date) to explanation and solution. Whether the product shows the mapping in-app is **not stated**. | Message catalogue with explanation + solution per code. | inspiration |
| Odoo (OD1) | HTTP-code → action table (200 none; 202 warnings "may become rejections in the future"; 303 submit via reporting; 400 review and resubmit; 401 fix credentials; 413 reduce size; 429/500/503/504 resend). Raw message shown verbatim with rule code, e.g. `[202] BR-KSA-F-13 : ... Please recheck Other Seller/Buyer ID (BT-29 or BT-46) ...`; "Retry" button after correcting the cause. | Two-layer message: **plain-language first, raw ZATCA code/message in an expandable detail**. Separate "transient, retry later" from "must correct data". | inspiration |
| Qoyod (Q2/Q3) | "Common rejection reasons and fixes" list (future date, VAT number, type mismatch, missing buyer info, tax calculation); "View" shows the error at the top; optional download of the XML to test on the ZATCA compliance portal. A separate "Error Center" with vendor-numbered pages. | Human-reason list per rejection; "download XML for diagnostics" in the detail. Do not invent AWJ-numbered codes that look like ZATCA codes. | inspiration; vendor error numbers rejected |
| Claudion (E3) | Error knowledge base organised by symptom title. | Help-center article per frequent symptom, linked from the message. AWJ's help center has no ZATCA article today. | inspiration (L) |
| Fix-and-resubmit semantics | Odoo: **Retry on the same invoice** after fixing settings. Qoyod Q2: rejected can **never** be edited/resubmitted — credit note then new invoice; Q3 (developer article): new ICV/UUID and resubmit. | AWJ's own contract is REM-24c: a rejected document requires a **new document**, never a resend of the same XML; transient failures are the only "retry". | unresolved (ADR-D; decision U4) |

### 3.5 Submission monitoring queue, retry, bulk resend

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| ZATCA portal (O1) | "E-invoicing statistics": 12-month counts for reporting and clearance by outcome, with request for **detailed CSV of errors and warnings** for the two non-green buckets. | An AWJ counts panel with the same three buckets + CSV export of failures; supports reconciliation. | official-UI |
| Daftra (D6) | Monitoring = **list filter** "Electronic Invoice Status" in Invoices Management Advanced Search (same on Refund Receipts). No dedicated queue observed. | Status filter on the existing invoices list as a first step. | inspiration |
| Odoo (OD2) | "To verify, compare the portal's invoices-received statistics with the invoice list in Odoo." Daily automatic sending of unprocessed invoices. No queue screen observed. | Reconciliation guidance next to the counts. | inspiration |
| ERPNext app (E2) | List-view bulk action **"Send Invoices to ZATCA"** acting on selected rows (with a prompt "Please select at least one Sales Invoice"); cron every 30 minutes; README "Reports to compare invoices with ZATCA portal statistics". | Bulk "retry selected" on the table with row selection (AWJ `DataTable` supports `selection`). | inspiration |
| Zoho (Z1) | Per-invoice push; recurring-invoice preference "Create, Push, and Send"; "If it fails to push, the reason for failure will be shown". No queue observed. | Show failure reason where the user already is. | inspiration |
| Wafeq (W3 snippet) | "dashboard shows live ZATCA state with Cleared and Reported badges" — snippet only. | — | unresolved (NOT OBSERVED) |
| **Net finding** | No competitor page examined shows a dedicated submission queue/dashboard with backlog counts, age, or deadline. The nearest are a list filter (Daftra) and a bulk list action (ERPNext app). | AWJ's REM-27 workspace would be ahead of the evidence base, so it is design-first. | unresolved |

### 3.6 Credit / debit note flow linked to the source invoice

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| Daftra (D7) | Actions "Create Credit Note" and "Create Refund Receipt" on the source invoice; refund receipt table pre-filled from the original, removable rows; original shows "Refunded". | Entry from the invoice; pre-filled lines. AWJ already has this for credit notes (section 4). | inspiration (exists) |
| Odoo (OD1) | "ZATCA Reason" **required** field with five listed reasons in the credit/debit window (also on Other Info tab); unrelated notes require the original invoice number in "Customer Reference". | Reason selector with the Authority's list + a manual original-number field for notes without a system source. Reason list content = ADR-E. | inspiration |
| Qoyod (Q4) | Start from the original invoice; choose full / specific lines / discount value; reference filled automatically; cleared invoices have no "Delete", only "Issue a credit note". | Make "issue a credit note" the correction affordance on cleared documents. | inspiration (L, vendor-described) |
| ERPNext app (E1) | Optional legacy mode: checkbox "Allow Credit-note without Original Invoice in the System" + "Return Against for ZATCA". | Legacy-invoice notes — only if Compliance accepts it; otherwise reject. | unresolved |
| Qoyod (Q2) | System **auto-creates and links** a credit note when a standard invoice is rejected. | Rejected (see section 6). | rejected |

### 3.7 QR, print, PDF/A-3, XML download

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| Odoo (OD1) | XML and the Send-generated PDF "permanently attached to the invoice and cannot be deleted"; "To automatically generate a PDF/A-3 with the embedded UBL 2.1, click Send"; QR verifiable with the official ZATCA app; draft-reset only in non-production. | Documents panel with immutable attachments; "Download XML", "Download PDF/A-3"; QR verification hint pointing to the official app. | inspiration |
| Zoho (Z1) | PDF exported "in A3 format as per ZATCA's regulation" (wording is ambiguous — likely PDF/A-3) with the pushed XML attached; QR generated by the push ("to generate the QR code"). | QR appears **as a consequence of the e-invoice state**, not before. | inspiration (wording needs verification) |
| Daftra (D8) | QR shown automatically on sales invoices; not on drafts nor pre-save preview; template variable fallback. | QR not rendered on drafts. AWJ doc renderer already hides it when absent. | inspiration |
| Qoyod (Q2) | QR only on approved invoices and credit notes, not on purchase invoices or debit notes (vendor claim); QR-missing troubleshooting list (feature off, draft, template, doc type). | A "why is there no QR?" explainer with the same four causes. | inspiration (L) |
| Daftra (D7) | A deletion in the ERP "cannot be deleted from the Fatoora platform". | Immutability copy. | inspiration |

### 3.8 Permissions and roles

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| Zoho (Z1 screenshot) | Role editor has a dedicated "e-Invoicing" group with a single "Push Transactions" checkbox. | A distinct submit permission shown in AWJ's role matrix (REM-37 `zatca.submit`). | inspiration |
| Qoyod (Q2) | "No separate e-invoicing permission is required"; anyone who can view invoices sees alerts/errors. | Counter-example for submission rights; acceptable for **read** of status (AWJ already has `zatca.view`). | inspiration (read) / rejected (write) |
| ERPNext vendor (E4) | Claims role separation between "who can onboard credentials" and "who can submit" — marketing only. | Same separation exists in AWJ's backend (`company.manage` for credentials vs `invoices.manage` for submit). | unresolved (L) |
| Odoo / Daftra | Role handling for e-invoicing | **NOT OBSERVED** | unresolved |

### 3.9 Arabic / RTL handling and accessibility

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| ZATCA portal (O1 screenshots) | Header toolbar offers a contrast toggle, font-size A-/A+, and an Arabic/English switch. | Confirms users expect contrast/text-size controls on compliance screens; AWJ has theme and language toggles already. | official-UI |
| Zoho (Z1) | E-invoice prerequisites include **Arabic** customer name, address and item name. | A data-language check ("standard invoice needs Arabic address/name") — whether ZATCA actually requires Arabic is a Compliance question (REM-14). | unresolved |
| Daftra (D4/D5) | ZATCA warnings displayed in **both Arabic and English**; address normalisation strips hidden bidirectional/formatting characters. | Bilingual message pair; sanitise bidi control characters in party/address data before they enter XML. | inspiration |
| Odoo (OD1) | Customer-level and document-level invoicing language; company name max 63 chars. | Document language selection exists in AWJ print templates. | inspiration |
| Qoyod (Q1) | Business name must be a single English word; address in Arabic. Looks like a product workaround. | Not adopted as a requirement. | rejected |
| Qoyod (Q1) | OTP "digit by digit, pasting not allowed". | Accessibility regression (assistive tech and password managers); rejected. | rejected |
| All competitors | **Arabic RTL screenshots of any ZATCA screen: NOT OBSERVED.** | RTL guidance below is derived from AWJ's own rules. | unresolved |

### 3.10 24-hour reporting deadline indicators / notifications

| Source | Evidence | Proposed AWJ use | Status |
|---|---|---|---|
| ZATCA Simplified Guide (O2) | The 24-hour reporting duration is stated as a regulatory process step; no UI. | Regulatory fact only (no UI in the document). | unresolved |
| Zoho (Z1), Odoo (OD1/OD2), Qoyod (Q2) | Text only: simplified invoices are pushed "within 24 hours"; Odoo sends unprocessed invoices at day end; Qoyod tells users to wait for the 24-hour window before escalating a "Processing" simplified invoice. **No countdown, deadline badge, or deadline notification was observed.** | Design-first (AWJ decision): a "reporting due in …" chip driven by REM-23 `zatca_reporting_due_at`. | unresolved |
| ERPNext vendor docs (E3) | Index title "Ensuring Timely Submission of B2C and POS Invoices in ERP Systems" (body not read); cron every 30 minutes (E2). | Scheduler cadence as a reference only. | unresolved |

---

## 4. What AWJ already has (so it is not re-recommended)

All paths are under `/home/user/Nebrax/web/src` unless noted.

| Area | What exists | File reference |
|---|---|---|
| E-invoicing settings entry | Card "E-Invoice (ZATCA)" shown only when application `compliance.zatca` is on. | `app/(app)/sales-settings/page.tsx:31` |
| Connection page | Gate on `/applications/nav-state` with a link to `/applications` when inactive; three readiness cards (active environment, invoice signing, submission to ZATCA) with named blockers mapped to messages; environment tabs `developer / simulation / production`; credential form per environment with stage `compliance` or `production`, request id, binary security token, secret, private key (all **pasted in**), current-password re-auth, production-confirmation checkbox, secrets never echoed back; credential summary badge (Complete / Incomplete), expiry, fingerprint, chain length; submission mode manual/automatic (automatic disabled until readiness) and active-environment select with a production warning; "Refresh readiness". | `app/(app)/sales-settings/einvoice/page.tsx` (messages `salesSettings.zatca_connection.*`, `messages/en.json` ≈6208–6270; Arabic mirror in `messages/ar.json`) |
| Invoice classification | Standard/simplified select (`zatca_document_type`) with auto-suggestion from the customer's 15-digit VAT number and a hint that the choice is snapshotted at posting; design-compatibility guard between template and ZATCA type. | `components/invoices/invoice-form.tsx:169,200,712-724`; `components/invoices/invoice-template-selector.tsx` |
| Invoice detail | Fetches `GET /invoices/{id}/zatca` (qr, hash, uuid, icv) in parallel and passes **only the QR** to the document renderer. **No status badge, no attempts list, no submit/retry button.** Existing i18n keys `vat_status`, `vat_generated`, `vat_not_generated` ("E-invoice status", "E-invoice data has been generated/not generated yet") are present but not referenced by any component. | `app/(app)/invoices/[id]/page.tsx:157-163,281,295,627,674,686`; `messages/en.json` ≈2216 |
| Lifecycle rail with independent axes | Invoice workspace already renders document lifecycle (draft › posted) and a separate payment axis as accessible lists with `aria-current="step"`; a ZATCA axis would reuse the pattern. Existing Playwright test pins "no prototype-only state" and will need the REM-24 update. | `components/workspace/lifecycle-rail.tsx`; `e2e/awj-v3-h2-workspaces.spec.ts:70-75` |
| Credit note linked to source invoice | "Create credit note" from a posted invoice opens `/credit-notes/new?invoice=<id>`; linked form loads returnable lines and blocked reasons from the server and previews amounts; no free-typed type or tax rate. **No ZATCA reason field, no note-level ZATCA status.** | `app/(app)/invoices/[id]/page.tsx:609,908`; `components/credit-notes/credit-note-linked-form.tsx`; `components/credit-notes/invoice-linked.ts` |
| QR on documents | QR section in shared document model, thermal receipt, A4 templates; QR hidden for quotations/POs; POS reads `zatca.qr` from the checkout response and shows a warning toast `zatca_qr_unavailable` if missing. | `modules/documents/components/sections/doc-qr.tsx`; `modules/documents/registry/document-types.ts:59,331`; `app/(pos)/pos/page.tsx:1430-1449` |
| Notification deep link | A ZATCA failure/reject notification opens the invoice (`view_zatca_submission` → `/invoices/{id}`); the code comment says the invoice page "displays the ZATCA state" — **today it does not**. | `lib/notifications.ts:76`; `app/Support/NotificationActions.php:31`; `app/Services/Accounting/ZatcaNotificationBridge.php` |
| Audit/revision log | ICV and hash are deliberately hidden from the revision log. | `components/documents/revision-log.tsx:29` |
| ICV scope setting | Guarded setting and explanatory copy for ICV scope. | `app/(app)/sales-settings/invoices/page.tsx`; `messages/en.json` ≈6323–6330 |
| Backend API the web does **not** consume | `GET /invoices/{id}/zatca/submissions` (attempt list: attempt number, type, source, status, requested/queued/completed times, HTTP status, response code/message/payload), `POST /invoices/{id}/zatca/submissions` (needs `Idempotency-Key` header, throttle 10/min, `invoices.manage`), `POST .../{attemptId}/dispatch`. Attempt statuses in code: `pending`, `accepted`, `rejected`, `failed`. | `routes/api.php:688-694,1620-1625`; `app/Http/Controllers/Api/ZatcaSubmissionController.php`; `app/Services/Accounting/ZatcaSubmissionService.php:99` |
| Permissions today | `zatca.view` exists in Rbac; there is no `zatca.submit` (submission rides on `invoices.manage`). | `app/Support/Rbac.php:36,43,84`; REM-37 |
| Missing entirely | Onboarding wizard (CSR/OTP/compliance/production), device list, tenant-wide submission monitor, bulk retry, deadline indicator, error-code catalogue, a ZATCA help-center article (none in `modules/help-center/content.ts`). | — |

---

## 5. AWJ recommendations — **recommendation, not decision**

Ranked by (user risk avoided) × (readiness of the backend dependency). "Fit" refers to `DESIGN_SYSTEM.md` (dense accounting tool, tables are the hero, one brand colour, green/red/amber strictly semantic and paired with an icon/text, RTL first, IBM Plex Sans Arabic + Plex Mono for codes/numbers, explicit empty/loading/error states, no decorative icon boxes). Competitor behaviour is design evidence only.

> **Sequencing warning.** Several states a UI would show ("Cleared", "Reported", "Accepted") are not yet trustworthy: the XML/stamp/QR pipeline fails the official validator today (REM-16/17, `docs/audits/AWJ-TAX-ZATCA-REMEDIATION-PLAN.md` §2 notes) and dispatch is disabled by default. A status UI that says "Accepted" before REM-11/16/17/21/24 would mislead. Recommendations marked **(gated)** should ship behind a feature flag or show neutral "attempt recorded" wording until their dependency is merged.

### R1 — ZATCA status on the invoice (header badge + side panel) (gated by REM-21/22/24)
- **What.** A third status axis in the existing lifecycle rail (document lifecycle · payment · **e-invoice**) and a "ZATCA" panel listing submission attempts (number, source manual/automatic, time, outcome, short message, "details" disclosure). Badge states (names are proposals): Not applicable (legacy/non-KSA/app off) · Not submitted · Queued/Sending · Accepted · Accepted with warnings · Rejected · Failed (will retry) · Needs reconciliation (in-doubt). For standard invoices the label reads "Cleared", for simplified "Reported" (ERPNext-app and Qoyod show the distinction; official portal uses the neutral "Accepted").
- **Evidence.** Daftra badge + disabled send button; Zoho stepper; Odoo three-colour outcome; Qoyod "Not applicable"; official three buckets.
- **Trade-off.** Two vocabularies (transport state vs authority outcome) make a richer model but more labels; Zoho's transport-only vocabulary is simpler but hides whether the Authority actually accepted.
- **RTL/a11y.** Badge = icon + text + colour (amber for warnings uses a triangle, red a cross, green a check); `aria-live="polite"` region for status changes after a manual submit; the lifecycle rail already exposes `aria-current`; UUID/hash/ICV in `dir="ltr"` Plex Mono (pattern already used in the connection page).
- **Fit.** Reuses `Badge` tones (`positive/warning/negative/muted`) and the lifecycle rail; no new colour.
- **Depends on.** REM-21 (outcome classification), REM-22 (in-doubt state), REM-24 (lifecycle driven only by `ZatcaSubmissionService::complete()`, gating of QR/print). A read-only attempts list can be built now on the existing `GET /invoices/{id}/zatca/submissions`, labelled neutrally until REM-24.

### R2 — "Accepted with warnings" is a distinct, calm state (REM-21)
- **What.** Amber badge with a fixed sentence: the invoice is valid; the notes are advisory from ZATCA; show the warning list in Arabic with the original text in the detail. Store/collect warnings for a trend count.
- **Evidence.** Daftra (explicit "valid, no action required", bilingual); Odoo (yellow, "may become rejections in the future" and "share with the solution provider"); the official portal counts them separately and offers a CSV.
- **Trade-off.** Daftra says "no action"; Odoo says "correct for future submissions". Choosing "no action" lowers noise but could hide issues the Authority later turns into rejections — see U2.
- **a11y/RTL.** Do not rely on amber alone; keep message text in the user's language with the raw English rule text in `dir="ltr"`.
- **Depends on.** REM-21 (warning vs error classification), REM-11 (SDK oracle supplies the code list).

### R3 — Pre-issue readiness checklist inside the invoice form (REM-12/13/14/15)
- **What.** In the existing invoice form, next to the standard/simplified select, a collapsible "Ready for ZATCA" list: seller identity complete, buyer data complete for the selected type, VAT category/reason present on zero/exempt lines, issue date not in the future. Each failing item links to the field. Posting is blocked only for the conditions the backend rejects; the rest are warnings. POS keeps the "never lose a sale" rule: save and flag.
- **Evidence.** Daftra's ordered validation and POS exception; Zoho's prerequisites box.
- **Trade-off.** Strict blocking prevents rejections but can stop a cashier; warn-only keeps flow but risks rejected documents. CLAUDE.md rule 6 says this is a configurable policy with a protective default (REM-15 already states that hard-blocking the buyer VAT number is a configurable policy).
- **a11y/RTL.** Checklist is a real list with per-item status text; links move focus to the field; Arabic labels first.
- **Depends on.** REM-12 (category model), REM-13 (issue time), REM-14 (seller/buyer validation and snapshots), REM-15 (classification as precondition).

### R4 — Error catalogue: stable code → Arabic/English message → fix link (REM-21, REM-11)
- **What.** Server returns a stable `code` (+ raw ZATCA rule id and text); the web maps `code` to a plain message and "what to do". Same approach as the inventory-opening module (`CLAUDE.md`: stable `code` with client-side AR/EN translation, fallback to server text). Three action classes: **Fix data and create a corrected document**, **Fix configuration and retry**, **Retry later (transient)**. Raw text in an expandable "Technical details" block.
- **Evidence.** Odoo HTTP-code/action table and raw `BR-KSA-…` message; Daftra message/explanation/solution table; Qoyod "common rejection reasons".
- **Trade-off.** A curated catalogue needs maintenance as ZATCA changes rules; a pass-through of raw text is zero-maintenance but unusable for most operators. Mitigate: unknown codes fall back to raw text with a generic action.
- **a11y/RTL.** Error summary at the top of the panel (`role="alert"` only for new rejections), codes in LTR mono.
- **Depends on.** REM-21 (classification stored on the attempt), REM-11 (code list from the SDK).

### R5 — Replace the paste-secrets form with an onboarding wizard (REM-19; keep manual import as an advanced path)
- **What.** Stepper: Prerequisites (identity checklist from Zoho's pattern) → Generate CSR (server-side key; no key shown) → Enter OTP (6 digits, 1-hour hint, paste allowed, `inputmode="numeric"`, `dir="ltr"`) → Compliance checks (progress per scenario) → Production CSID → Done. Per-environment state, a device/EGS table mirroring the Fatoora list fields (serial, VAT number, status, onboarded, expiry, revoked), explicit **Renew** and **Revoke** with confirmation and "cannot be undone" copy. Keep the current environment tabs, re-authentication and production confirmation.
- **Evidence.** Official portal (OTP validity, renewal, revocation, list); Daftra two-card choice; Odoo per-unit Onboard + "Regenerate CSR"; Zoho prerequisites modal and Renew/Disconnect; ERPNext app as a map of states.
- **Trade-off.** Wizard hides protocol complexity (good for taxpayers, hides debugging detail) vs three-buttons (ERPNext app) which is transparent but error-prone. A collapsed "Details" per step recovers transparency.
- **a11y/RTL.** Steps as an ordered list with `aria-current`; OTP not announced as a password; numerals Latin in the OTP field regardless of locale; step text Arabic first.
- **Fit.** Cards with 8px radius, one primary button per step, no illustrations.
- **Depends on.** REM-19 (onboarding lifecycle), REM-25 (environment-scoped chains, guard environment switching), REM-26 (fail-closed readiness). Until REM-19, the current page stays.

### R6 — Submission monitoring workspace (REM-27, REM-23)
- **What.** A tenant-wide table (route to decide, U5): document, type (standard/simplified), branch, status, last attempt time, attempts, message, **due-by** for simplified. Top strip of counts using the official three buckets plus "Queued/In-doubt/Failed"; filters (status, type, branch, date); row selection with **Retry selected** (disabled for rejected documents) and CSV export of failures; a "Compare with Fatoora statistics" hint beside the counts.
- **Evidence.** Daftra status filter; ERPNext app bulk action and "compare with portal statistics"; Odoo's "compare ... with invoice list"; official statistics + CSV. No competitor ships a full queue, so the table design is AWJ-original.
- **Trade-off.** Strong monitoring reduces the chance a simplified invoice misses its window, at the cost of another screen to maintain; a filter on the existing invoices list is the minimal version.
- **a11y/RTL.** `DataTable` with `selection`, keyboard-reachable row actions, numbers right-aligned in Plex Mono, bulk-action result announced via toast (`aria-live`).
- **Fit.** Best fit with "tables are the hero".
- **Depends on.** REM-27 (`GET /zatca/submissions` tenant-wide, counts, bulk retry endpoint), REM-23 (`zatca_reporting_due_at`, sweep), REM-37 (who may bulk retry).

### R7 — 24-hour reporting indicator (design-first) (REM-23, REM-27)
- **What.** On simplified invoices not yet accepted, a chip "reporting due in Xh" (neutral → amber → red thresholds are a setting, safe default), shown in the monitoring table, invoice panel and the notification digest; copy says "from issuance" and links to the explanation.
- **Evidence.** None observed. Official guide states the 24-hour step only as process text. Competitors tell users the rule in prose.
- **Trade-off.** Valuable for compliance but a wrong clock (timezone, issue vs posting time, REM-13) is worse than no clock. Needs Compliance sign-off on the start instant before showing a number.
- **a11y/RTL.** Time remaining as text ("باقي ٥ ساعات"), not colour only; thresholds not announced repeatedly.
- **Depends on.** REM-13 (issue instant), REM-23 (`zatca_reporting_due_at`), REM-27 (digest).

### R8 — ZATCA-aware credit/debit notes (REM-18, REM-02, REM-31)
- **What.** Keep the existing linked form; add a required **reason** selector (list per ADR-E), a read-only source-invoice reference block (number, date, ZATCA state, link), the note's own status badge (R1), and a non-blocking banner when the issuance deadline is passed (default warn-only, REM-31). For standard invoices that were rejected, the call to action is "Create corrected invoice", not "edit and resend".
- **Evidence.** Odoo reason field and Customer Reference; Qoyod/Daftra start-from-invoice flows; AWJ's own linked form.
- **Trade-off.** A mandatory reason adds a field to every return but is a Phase-2 duty per the plan (REM-18 notes reason as BR-KSA-17); free-text reasons are faster but not mappable.
- **Depends on.** REM-18 (type 381/383, BillingReference, reason), REM-02 (VAT basis inherited), REM-31 (deadline control).

### R9 — Documents panel for QR / XML / PDF-A3 gated by state (REM-24, REM-36)
- **What.** "Documents" section on the invoice: signed XML, PDF/A-3, QR image; enabled only in states that allow them (standard invoices only after clearance; simplified with reporting state shown), immutable once generated, with a "Why is the QR missing?" explainer (feature off, draft, not yet cleared, template lacks QR).
- **Evidence.** Odoo immutable attachments and PDF/A-3 via Send; Zoho QR generated by push; Daftra/Qoyod QR-missing troubleshooting.
- **Trade-off.** Gating protects against giving customers uncleared standard invoices (SUB-01) but changes today's behaviour — the plan flags a feature flag and an ADR (ADR-D).
- **Depends on.** REM-24 (gating, cleared-XML consumption, PDF/A-3), REM-36 (retention/export).

### R10 — Visible separation of duties (REM-37)
- **What.** In the roles table (owner/admin tab in `/hr`) add a ZATCA group: view, **submit**, manage credentials. In the UI, show submit/retry actions disabled with a tooltip naming the missing permission rather than hiding them.
- **Evidence.** Zoho "e-Invoicing > Push Transactions"; Qoyod as counter-example.
- **Trade-off.** Extra permission to grant at upgrade (REM-37 notes a one-time grant).
- **a11y.** Disabled controls keep `aria-disabled` + visible reason text; no tooltip-only explanations.
- **Depends on.** REM-37.

### R11 — Help-center articles per frequent failure and for onboarding (no backend dependency)
- **What.** Add Arabic-first help articles ("How to get the OTP", "Which OTP", "Standard vs simplified", "What does accepted-with-warnings mean", per-symptom fixes) and link them from messages in R4/R5.
- **Evidence.** Daftra and Claudion organise help by symptom.
- **Depends on.** Content review by Compliance (wording of regulatory statements must not be copied from vendors).

---

## 6. Rejected / not adopted

| Item | Reason | Category |
|---|---|---|
| Qoyod "paste not allowed, type digit by digit" OTP field | Breaks password managers, assistive technology and copy-from-file (the official portal explicitly offers copy/download of the OTP). | Mismatch / accessibility |
| Qoyod "business name must be a single English word" and similar field workarounds | Looks like a product limitation, not a ZATCA rule; would create wrong data. | Mismatch |
| Daftra "deactivate the e-invoice app to edit/delete invoices during trial" | Toggling immutability by a switch contradicts AWJ architecture rule 3 and REM-07 (immutability of posted documents). Non-production data handling is governed by `AWJ_PRE_PRODUCTION_DATA_POLICY.md`, not by a UI toggle. | Legal / architecture |
| Qoyod auto-creating and linking a credit note when a standard invoice is rejected | Creates a financial document without an explicit user act; a rejected document never entered the Authority's records, so the correct action is a new document (REM-24c). | Legal / accounting |
| Odoo/Qoyod "Retry"/resubmit of the **same** rejected XML | REM-24c: a rejected document needs a new document (ICV+1), not a resend of the same XML. Retry only for transient failures. | Mismatch with plan |
| Zoho-style transport-only statuses (Yet-to-be Pushed / Push Initiated / Pushed / Failed) as the **only** vocabulary | Cannot express cleared vs reported vs warnings vs rejected; the official portal reports outcomes in three buckets. | Mismatch |
| Qoyod "Error Center" codes 1001–1020 | Vendor-invented numbers presented next to real rule ids; AWJ must not publish codes that look like ZATCA's. | Legal / copy risk |
| Vendor-stated regulatory rules used as UX evidence (Wafeq "15 calendar days", Qoyod "five tags", Zoho wave dates, Daftra "1 minute" OTP) | Unverified or internally contradictory; only the official documents and ADRs decide rules. | Legal |
| Colour-only status (Odoo's green/yellow/red chatter tinting) | Violates DESIGN_SYSTEM rule "colour + sign, not colour alone". | Mismatch |
| Exposing protocol steps as three separate buttons (ERPNext app: create CSR / compliance CSID / production CSID) | Error-prone for non-technical taxpayers; use as a state map only. | Mismatch |
| Legacy-invoice credit notes without a system source (ERPNext app checkbox) | Only if Compliance accepts it; otherwise it bypasses BillingReference integrity. | Unresolved → not adopted by default |
| Copying vendor screens, wording, icons, or the Authority's portal look and logos | Copy and impersonation risk. Only the **information model** is reused; AWJ uses its own tokens and Arabic copy. | Copy risk |
| Single-word "Valid"/"Invalid" labels | "Valid" can be read as a legal conclusion; AWJ should state what happened (accepted/rejected by the Authority) not certify validity. | Legal wording |

---

## 7. Open UX decisions (for the owner / Compliance — not resolved here)

| # | Decision | Why it is open | Related |
|---|---|---|---|
| U1 | Status vocabulary in Arabic and English: unified "Accepted" vs "Cleared"/"Reported" by document type; wording for in-doubt. | Official portal uses accepted/with warnings/rejected; ERPNext app and Qoyod show clearance vs reporting. Legal tone of each label. | REM-21/22/24, ADR-D |
| U2 | Handling of warnings: informational only (Daftra) vs "review for future submissions" (Odoo). Count and trend? | Odoo notes warnings may become rejections; evidence conflicts. | REM-21 |
| U3 | Block vs warn at issuance for each readiness item (buyer VAT number, address, category/reason). | Policy with more than one defensible answer → a setting with a protective default (CLAUDE.md rule 6). | REM-12/14/15 |
| U4 | Correction path after rejection: guided "create corrected invoice" vs credit-note-then-new; what a standard invoice looks like **before** clearance (draft-like watermark? no PDF/share?). | Competitors differ; ADR-D pending. | REM-24, REM-34 |
| U5 | Where monitoring lives: extend `/sales-settings/einvoice`, a new top-level e-invoicing workspace, or filter on `/invoices` first. | Sidebar group/appKey and permissions implications. | REM-27 |
| U6 | Onboarding unit: per tenant, per branch, or per device (Odoo per journal; Daftra per branch). Interacts with ICV scope guard (`ZatcaIcvScope`). | Requires an EGS-model decision before the device table is designed. | REM-19, REM-25 |
| U7 | Deadline indicator: start instant (issue vs posting vs QR time), thresholds and channels (in-app, email, digest). | No competitor evidence; wrong clock is harmful. | REM-13, REM-23, REM-27 |
| U8 | Who may bulk retry; rate limits; confirmation for large batches. | Existing route throttle is 10/min; bulk semantics undefined. | REM-27, REM-37 |
| U9 | Whether ordinary users see UUID, ICV and hash (revision log currently hides them) or only operators with `zatca.view`. | Transparency vs noise. | `revision-log.tsx:29` |
| U10 | Help-center content owner and review path for regulatory wording. | Prevents copying unverified vendor claims. | R11 |
| U11 | A visual pass on **Arabic/RTL** screens of at least two competitors and the official Arabic portal, plus Salla/Zid/Rewaa (not reachable in this pass). | This pass saw English LTR screenshots only. | Section 1 |
| U12 | Legacy-document policy: show "Not applicable" for documents issued before go-live (Qoyod) — and what AWJ tenants get after REM-20 default-on. | Needs a cut-over date semantic similar to `ENFORCEMENT_CUTOVER_AT`. | REM-20 |
