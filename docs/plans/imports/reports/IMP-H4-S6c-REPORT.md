# IMP-H4-S6c — Unit templates import wizard (UI)

**Branch:** `claude/imp-h4-s6c-unit-template-wizard`. **Web only:** no backend, migration, permission, env or ZATCA change. **No journal entries** — unit templates are catalogue data; no product is linked, no stock quantity or cost is touched, nothing is posted.

## What it adds
- Route `/inventory-settings/units/import` and an «Import from file» button on the units screen (`SettingsHeader` action slot added in H4-S6a).
- `UnitTemplateImportWizard` for the merged `unit_templates` domain (H4-S5, D-08: **no AI path**). Setup (file · existing-template policy · column mapping) → Preview (no writes) → preview-bound durable job → Result (templates created · alternate units created · templates skipped).
- **Atomic domain (`UNIT_FILE`):** the whole file is one transaction, so there is no progress bar, no chunk loop and no row repair; a failed job says plainly that nothing was written and offers only a fresh start. (Differs from the row-domain wizards.)
- **Create-only.** Policy for a template that already exists by name: *error* (default) or *skip whole*. No update, no adding units to an existing template (server rule PR-UOM-1, stated on screen).
- Mapping guard mirrors the server: template name and base unit required; alternate unit and factor mapped **together or not at all**; no field mapped twice. The factor (2…1,000,000) multiplies incoming stock quantity, so no default is ever proposed.
- Hardening carried over: stale job never re-applied, creation failure visible, spent-binding Apply disabled, foreign-domain and unbound jobs refused, stepper cannot jump to a missing preview, explicit Continue for a bound job paused mid-way, latest-wins sequencing, formula-safe error CSV.
- ar/en `unitTemplateImport` block (key parity scripted: 0 differences, every `t()` key resolved).

## Tests
`UnitTemplateImportWizard.test.tsx` 12 + `contract.test.ts` 6 (18). Mutation controls (each fails tests when applied): unit/factor pairing ignored · foreign-domain guard removed · `existing_policy` not sent · Continue ignoring the preview binding · failed-job note removed.

## Review dispositions
Independent review and Codex review: see PR thread (appended on merge).

## Limits / follow-ups
- Component tests only; no screenshots.
- `is_active` is offered in the mapping (server field) but the preview does not display it.
- IMP-WIZARD-STATE-01 (older wizards, engine-level `resume` domain check) unchanged. Closes the H4 UI group (S6a/S6b/S6c).
