# IMP-H3-S3 — Customers & suppliers import UI

**Branch:** `claude/imp-h3-s3-partner-import-ui` (stacked on H3-S2 → H3-S1) · **Web only.** No backend, migration, env, ledger, ZATCA or AI-setting change.

## What it adds

- `/partners/import` (customers) and `/suppliers/import` (suppliers): one shared `PartnerImportWizard` — the entry point fixes the type, never the file.
  1. **File & rules** — drag/drop or pick a CSV/XLSX; the file is inspected on pick (`/partners/import/inspect`); mode (create / update / update-or-create) with a one-line explanation, empty-cell policy, and the **duplicate-signal policy** (warn / skip / error for VAT, CR, phone, mobile, email) with its explanation; column mapping table with samples and live gap messages (required `name` for create/upsert, an identifier for update/upsert, one column per field). A note states that opening balances are not imported here (D-01).
  2. **Review** — counters (create / update / skip / warnings / errors), the first 5 errors expandable to 50, a CSV of every error (formula-neutralised), and **Apply is disabled while any row has an error or when no preview binding exists**.
  3. **Apply** — the shared `ImportJobStatusPanel` + durable engine: a single-use preview-bound job; the page does not re-send semantic options (the server freezes them), progress is the server's `processed_rows`.
  4. **Result** — created / updated / skipped; failed rows can be downloaded and repaired through the shared `ImportRepairPanel` (S8c) — no per-domain repair code.
- Entry points: an "Import" button on the customers header and the suppliers header, shown only with `partners.manage` (the server enforces it regardless).
- Template download (`/partners/import/template?type=`), AR/EN copy (`partnerImport` namespace), `partner_master` added to the engine client's domain type.
- A late preview/inspect response for a file or mapping that has since changed is discarded (sequence guards), and any change to mode/policy/mapping/file invalidates the preview — the stale-preview class of issue found in the H2-S3 review is avoided from the start.

## Tests

- `contract.test.ts` (4): mapping gap rules, form encoding incl. explicit `ignore`, job options mirror the preview options, formula neutralisation.
- `PartnerImportWizard.test.tsx` (4): inspect → mapping → preview sends the entry-point type and an explicit mapping; required-field and identifier gaps block the preview; a preview-bound durable job is created with the preview id/options and applies with an empty body; a preview with errors cannot be applied and exposes the error report.
- Existing partners page suite (9) unchanged and green; typecheck clean for the touched files; full web suite and production build recorded on the PR.

## Disclosures

- No screenshots / visual check (consistent with the earlier web slices); verified by component tests and typecheck only. Mobile layout reuses the existing shared components.
- The customers/suppliers list entry points are a plain header button; if you prefer them inside an overflow menu, that is a UX call, not a functional one.
- No Codex review (quota exhausted); no subagent review for this UI slice (the backend it drives was reviewed in S1).
