# PR-12 local fixture screenshot notes

- **Arabic tenant operations, desktop:** verified locally at `/documents/operations` in demo mode. RTL shell, the four Document Center tabs, seven operational summary cards, retention policy card, desktop table, mobile fallback markup, safe failed/retry-able state, disabled extraction state, review and diagnostic links all render from local fixture data only.
- **Evidence boundary:** the fixture is explicitly labelled preview/demo and has no server connection. It contains no object key, signed URL, provider payload, secret, or financial record.

Further labelled captures are stored under `docs/intelligent-document-center/screenshots/pr12/` after each visual verification.
- **Arabic tenant governance, desktop:** verified locally at `/documents/governance`; RTL cards expose the effective 365-day manual policy, active hold, safe-code forms, redaction allowlist, and audit export control.
- **English LTR switch:** verified on the same local fixture after the in-product locale switch; every `documentOperations` label renders in English and the layout reverses to LTR without a missing translation key.
- **English tenant operations, desktop:** verified locally at `/documents/operations`; LTR layout, all four navigation links, retry state, diagnostic links, and safe processing messages render correctly.
- **English platform operations, desktop:** verified locally at `/platform/document-operations`; the separate platform fixture shows worker offline, provider network locked, usage evidence, editable retention policy, dry-run default, explicit apply confirmation, and audit export.
- The locale toggle uses the local `locale` cookie, enabling reproducible Arabic/English fixture captures without external requests.
- **Arabic tenant operations, mobile (390×844):** the sidebar collapses into the compact mobile header; document-center navigation remains usable; metrics use two-column cards; each operational item becomes an accessible card with retry, diagnostics, and review actions.
- **English tenant usage, dark mode:** the dark theme preserves readable contrast for filters, seven usage metrics, the unavailable-cost message, provider/model table, and export control.
| التحقق | النتيجة |
|---|---|
| Playwright `document-operations.spec.ts` على desktop | نجحت تدفقات operations وusage/governance وplatform fixture. |
| Playwright `document-operations.spec.ts` على mobile | نجحت تدفقات operations وusage/governance وplatform fixture مع اختيار العناصر المرئية فقط. |

تستعمل هذه الاختبارات `localhost` وبيانات وضع المعاينة المعلنة. وهي لا ترسل طلب API حقيقياً ولا توفر دليلاً على تفعيل أي مزود أو queue أو تخزين دائم.
