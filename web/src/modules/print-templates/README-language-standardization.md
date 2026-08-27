# Document language standardization integration contract

This branch introduces `ar`, `en`, and `bilingual` as revision-level document language modes independent from ERP / Modern / Minimal composition.

Integration rules:

- Historical revisions without `language_mode` keep their previous behavior by falling back to the active UI locale.
- Draft create/update requests validate `language_mode`; arbitrary values are rejected by the API.
- Preview direction is derived from language mode: English is LTR; Arabic and bilingual are RTL-first.
- Language changes must never recalculate or reinterpret accounting values.
- Company legal identity belongs in the document header; company contact identity belongs in the footer.
- Posted/frozen historical documents must continue to render from their saved revision/snapshot semantics.

Remaining before merge:

- Wire the language-aware definition and selector into `PrintTemplateStudio` draft state/save flow.
- Run full frontend/backend tests, TypeScript, build, and manual Document QA for Arabic / English / bilingual across ERP / Modern / Minimal.
