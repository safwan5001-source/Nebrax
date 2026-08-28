# Authorization Matrix — Intelligent Document Center

> **قاعدة مشتركة لمسارات المستأجر:** `auth:sanctum` ثم `SetTenant` ثم `SetBranch`، ثم `EnsureActiveSubscription`، ثم permission وقرار `EnsureCommercialApplicationAccess`. لا يقبل أي endpoint مستأجر `tenant_id` أو `branch_id` من body؛ المصدر هو المستخدم المصادق والسياق الموثوق.
> **قاعدة مشتركة لمسارات المنصة:** `auth:sanctum` ثم `EnsurePlatformAdministrator` مع قدرة Sanctum المطلوبة، من دون `SetTenant` أو `SetBranch` ومن دون token مستخدم tenant.

| Surface / endpoint | Class | Auth | Tenant | Branch | Permission / ability | Entitlement | App state | Platform admin |
|---|---|---|---|---|---|---|---|---|
| `POST /document-batches` | Write | Sanctum tenant | trusted | trusted | `documents.center.manage` | `document_center.core` write | enabled only | لا |
| `POST /document-batches/{batch}/files` | Write | Sanctum tenant | scoped binding | scoped binding | `documents.center.manage` | core write | enabled only | لا |
| `POST /document-batches/{batch}/complete` | Write | Sanctum tenant | scoped binding | scoped binding | `documents.center.manage` | core write | enabled only | لا |
| `GET /document-files/{file}/download-url` | Read / signed URL issue | Sanctum tenant | scoped binding | scoped binding | `documents.center.view` | core read | enabled أو suspended read-only | لا |
| `GET /document-files/{file}/download` | Read / binary export | Sanctum tenant + signed URL | scoped binding | scoped binding | `documents.center.view` | core read | enabled أو suspended read-only | لا |
| `GET /document-batches` | Read | Sanctum tenant | automatic | automatic | `documents.center.view` | core read | enabled أو suspended read-only | لا |
| `GET /document-batches/{batch}/review` | Read | Sanctum tenant | scoped binding | scoped binding | `documents.center.view` | core read | enabled أو suspended read-only | لا |
| `POST /document-batches/{batch}/review-changes` | Write | Sanctum tenant | scoped binding | scoped binding | `documents.center.review` | core write | enabled only | لا |
| `POST /document-batches/{batch}/assign-reviewer` | Write | Sanctum tenant | scoped binding | scoped binding | `documents.center.manage` | core write | enabled only | لا |
| `POST /document-match-results/{match}/confirm|reject` | Write | Sanctum tenant | scoped binding | scoped binding | `documents.center.review` | core write | enabled only | لا |
| `POST /document-issues/{issue}/resolve|reopen` | Write | Sanctum tenant | scoped binding | scoped binding | `documents.center.review` | core write | enabled only | لا |
| `POST /document-batches/{batch}/revalidate-financial` | Write evidence validation | Sanctum tenant | scoped binding | scoped binding | `documents.center.review` | core write | enabled only | لا |
| `POST /document-batches/{batch}/complete-review` | Write workflow | Sanctum tenant | scoped binding | scoped binding | `documents.center.review` | core write | enabled only | لا |
| `POST /document-batches/{batch}/create-purchase-draft` | Write draft only | Sanctum tenant | scoped binding | scoped binding | `documents.center.build_draft` | core write | enabled only | لا |
| `POST /document-batches/{batch}/create-expense-draft` | Write draft only | Sanctum tenant | scoped binding | scoped binding | `documents.center.build_draft` | core write | enabled only | لا |
| `GET /document-operations` | Read | Sanctum tenant | automatic | automatic | `documents.center.operations` | core read | enabled أو suspended read-only | لا |
| `POST /document-processing-runs/{run}/retry` | Write / dispatch attempt | Sanctum tenant | scoped binding | scoped binding | `documents.center.retry` | core write | enabled only | لا |
| `GET /document-usage` | Read | Sanctum tenant | automatic | automatic | `documents.center.usage` | core read | enabled أو suspended read-only | لا |
| `GET /document-usage/export` | Export | Sanctum tenant | automatic | automatic | `documents.center.usage` | core read | enabled أو suspended read-only | لا |
| `GET /document-governance` | Read | Sanctum tenant | automatic | automatic | `documents.center.settings` | core read | enabled أو suspended read-only | لا |
| `POST /document-retention-holds` | Write | Sanctum tenant | trusted batch/file scope | trusted branch | `documents.center.settings` | core write | enabled only | لا |
| `POST /document-retention-holds/{hold}/release` | Write | Sanctum tenant | scoped binding | scoped binding | `documents.center.settings` | core write | enabled only | لا |
| `POST /document-redactions` | Write overlay | Sanctum tenant | trusted result scope | trusted branch | `documents.center.settings` | core write | enabled only | لا |
| `GET /document-audit/export` | Export | Sanctum tenant | automatic | automatic | `documents.center.audit_export` | core read | enabled أو suspended read-only | لا |
| `GET /document-batches/{batch}/diagnostics` | Read diagnostics | Sanctum tenant | scoped binding | scoped binding | `documents.center.operations` | core read | enabled أو suspended read-only | لا |
| internal `WebDocumentSourceConnector` | Internal write | resolved identity + `DocumentSourceAccessGate` | identity only | identity only | `documents.center.manage` | core write | enabled only | لا |
| `api` source connector | Explicit deny | لا public route | — | — | — | — | — | لا |
| `POST /delivery-notes/invoice-draft/preview` | Read-only preview | Sanctum tenant | trusted | trusted | `delivery_notes.invoice` | `sales.invoicing` read | enabled أو suspended read-only | لا |
| `POST /delivery-notes/invoice-draft` | Write draft only | Sanctum tenant | trusted | trusted | `delivery_notes.invoice` | `sales.invoicing` write | enabled only | لا |
| `GET /platform/document-operations` | Platform read | Sanctum platform | none | none | `platform:read` | n/a | n/a | نعم |
| `GET /platform/document-usage` | Platform read | Sanctum platform | none | none | `platform:read` | n/a | n/a | نعم |
| `GET /platform/document-diagnostics` | Platform read | Sanctum platform | none | none | `platform:read` | n/a | n/a | نعم |
| `PATCH /platform/document-retention-policy` | Platform write | Sanctum platform | none | none | `platform:manage` | n/a | n/a | نعم |
| `POST /platform/document-retention-runs` | Platform write / manual operation | Sanctum platform | runner re-scopes per file | runner re-scopes per file | `platform:manage` | n/a | n/a | نعم |
| `GET /platform/document-audit/export` | Platform export | Sanctum platform | aggregate only | aggregate only | `platform:manage` + throttle | n/a | n/a | نعم |

## Binding and denial conventions

Document Center model bindings resolve under tenant and branch scopes after the contexts are installed. A foreign UUID is intentionally indistinguishable from a missing row at the binding/query layer where that is the project convention; a valid in-scope row with a missing permission/entitlement/state is denied with 403. Platform routes are not a tenant support bypass: they require a separate `PlatformAdministrator` principal and token ability, and their safe aggregate/detail projections may not expose tenant secrets, object keys, raw evidence, signed URLs, or credentials.

The matrix is a contract: an endpoint introduced without a row, explicit read/write/export classification, and the applicable test negatives is a defect. The explicit `withoutGlobalScopes()` retention traversal is a service-only exception, not an endpoint authorization substitute; it re-establishes trusted tenant/branch context for each candidate before any decision or write.
