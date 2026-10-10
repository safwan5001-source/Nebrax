# AWJ-TAX-ZATCA-AUDIT-1 — evidence folder

Supporting material for the audit reports in the parent folder:

| Deliverable | File |
|---|---|
| A — audit report | `../AWJ-TAX-ZATCA-AUDIT-1.md` |
| B — gap matrix | `../AWJ-TAX-ZATCA-GAP-MATRIX.md` |
| C — remediation plan | `../AWJ-TAX-ZATCA-REMEDIATION-PLAN.md` |

Audited commit: `0534ef16543b01c69b416b58897337e012a9d1ab`. Audit-only: nothing in the application, schema, tests, configuration or credentials was changed; no live ZATCA traffic; no production data. Everything here is Markdown.

## Contents

| File | What it is |
|---|---|
| `R1-regulatory-register.md` | Register of 229 regulatory requirements (VAT Law, Implementing Regulations, E-Invoicing Regulation and Resolution, guidelines) with document, article/section/page, version/date, applicability and verification label; document inventory; VAT-return box table; phase timeline; conflicts between sources; Top-25 list |
| `R2-technical-register.md` | Register of 66 technical requirements (XML standard, Data Dictionary, Security Features standard, developer-portal manuals, SDK 238-R3.4.8) incl. BR-KSA/EN16931 rule tables, arithmetic and cryptographic parameters, known pitfalls |
| `R2-sdk-howto.md` | How the official SDK was run offline (JDK 11, UTF-8) and what was found |
| `working-papers/` | The six domain working papers (streams A–F): scope and files read, positive controls, findings with evidence, NOT VERIFIED lists, cross-stream notes, appendices (coverage matrix, route/permission tables, state machine). Unedited — see the banner in each |
| `verification-log.md` | The lead's independent re-reads and re-runs of the P0/P1 findings, re-ratings and calibrations |
| `gap-matrix-review-notes.md` | Conflicts found while mapping findings to register rows |
| `test-results.md` | Existing PHP test results: the targeted runs per class on SQLite and PostgreSQL, and the full-suite runs with the controlled, per-test attribution of the 124 first-run failures |
| `web-test-results.md` | Vitest (whole suite) and Playwright (selected specs) results for `web/`: per-topic file list, per-spec results, the failures with their proximate errors and what was established |
| `web-test-mapping.md` | Every web-dependent finding mapped to the Vitest/Playwright tests that touch it (pins, contradictions, no coverage), `file:line` for each; used to correct four sentences and to plan REM-15/24/34/38 |
| `official-documents-used.md` | The inventories of official documents (regulatory and technical) that §10.1–10.2 of the report carried in its first revision |
| `repository-files-cited.md` | The grouped list of repository paths cited as evidence (Appendix A of the report in its first revision) |
| `sdk-validation-extracts.md` | Validator output for AWJ-generated documents and for the rounding/arithmetic experiments |
| `probe-outputs.md` | Outputs of the purpose-written probes cited in the findings |

## Conventions

* `<audit-workspace>` replaces the absolute path of the temporary audit workspace (probe sources, raw logs, downloaded official documents and the SDK). It is not part of the repository; the extracts that matter are reproduced in this folder. `<harness>` is the assembled Laravel harness used only to execute tests and probes; `<repo>` is the audited repository.
* Verification labels in the registers: `VERIFIED-FROM-SOURCE`, `VERIFIED-BY-SDK`, `RECALLED-UNVERIFIED` (not relied on for any finding).
* The official documents and the SDK are ZATCA's; they were downloaded from `zatca.gov.sa` on 2026-10-10 and are not redistributed. URLs, versions and SHA-256 prefixes are in the registers' inventories.
* No secret is contained in this folder; token-like strings printed by probes were redacted.

## Reproducing a probe

1. Check out the audited commit and assemble the Laravel harness with `setup.sh` (see `CLAUDE.md`).
2. Run a purpose-written probe as a PHPUnit file by absolute path against an isolated SQLite file or a throw-away PostgreSQL database, for example `DB_CONNECTION=sqlite DB_DATABASE=/path/to/empty.sqlite php artisan test /path/to/Probe.php`. Never point a probe at a shared or production database.
3. The SDK runs need JDK 11 with `-Dfile.encoding=UTF-8` (see `R2-sdk-howto.md`).
