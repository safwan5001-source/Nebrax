# Work group — H8: Import Hub, entry-point guard, saved mapping presets

## Done
| Slice | PR | Merge SHA | Scope |
|---|---|---|---|
| IMP-H8-S1 | #1794 | `6b0acd2` | `/imports`: entity table (12 entities, standard path for all, assistant path for products only), filterable import-jobs history with resume links, sidebar entry |
| IMP-H8-S3 | #1795 | `4ce4aac` | Audit: every entity screen already had its entry; added a guard test (15) pinning each entry and that only products offers an assistant entry |
| IMP-H8-S2a | #1796 | `1247cdf` | `import_mapping_presets` (CompanyWide, header-keyed), `import-mapping-presets` list/save/delete/match, authorised by the import domain's own gates, advisory-locked name + limit checks |
| IMP-H8-S2b | #1798 | `4067407` | `MappingPresetBar` in eight engine wizards (apply by header via server match, save, delete with confirm), stale-response guard |
| IMP-H8-S2c | #1799 | `6a017b9` | The same bar on the products V2, workbook and opening-balance pages |

## Review outcomes
- #1798: one Codex P2 fixed before merge — a late `match` response could overwrite a newly inspected file's mapping; now discarded via a per-bar epoch (unmount / header change), and the merge reads the mapping as it is at response time. Two regression tests, both mutation-verified.
- No review findings on #1794, #1795, #1796, #1799.

## Tests
Web: Hub 12 + entry-point guard 15 + presets 6 / bar 9 / wiring 11 / wizard behaviour 1; full local web suite 747 files / 8,908 tests green at the last merge. PHP: `ImportMappingPresetTest` 11 (SQLite + PostgreSQL) + `ImportMappingPresetConcurrencyPostgresTest` 2 (real `pcntl_fork`); `BranchIsolationGuardTest` green; CI full suite on both engines green on every PR. Mutation controls recorded in each slice report.

## Journal entries
None in any slice of this group (navigation, tests, and a settings table of header texts and field keys).

## Disclosed deviations and limits
- **H8-S1 vs the plan's precondition** («needs ≥2 entities with both paths»): only products has an assistant path today, so the assistant column shows a link there and «not available for this entity yet» elsewhere. Reversible; the column fills in as AI slices land.
- **AI-action history is not in the Hub:** no list endpoint exists for `ai-actions`; needs a backend slice with scoping design.
- Research: HubSpot's UI screenshots were viewed directly; Zoho, QuickBooks and Daftra were read as help text only (their UI images were unreachable).
- The advisory-lock removal is caught every time by the name-race test but only about one run in three by the limit-race test (probabilistic by nature).
- Run policies are deliberately not stored in presets (rule 6).

## Risks
Low: no accounting path touched. The only schema change is the additive `import_mapping_presets` table (rollback refuses once rows exist). Nothing deployed; no Railway/env change.

## Remaining (all gated, nothing unblocked inside the Horizon)
AI slices (H3-S4, H4-S4, H5-S5, H7-S2, H7-S4) → X-01 / OPS-02; AI-action history in the Hub → `ai-actions` list endpoint (design first); H6 → D-03; H1-S6 (#1626 Draft) → D-13; owner decisions D-01..D-04, D-06, D-07, OPS-01, IMP-DOC-DISTINCT-01.
