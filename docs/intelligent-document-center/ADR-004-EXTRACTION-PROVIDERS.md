- **Status:** Accepted
- **Date:** 2026-08-24
- **Scope:** PR-4 — extraction provider, platform configuration, normalization, and safe operational evidence

## Context

The intelligent document center needs bounded, asynchronous extraction of evidence from files that have already passed the PR-2 and PR-3 intake and safety contracts. Extraction is probabilistic and involves external processors, while the center must retain tenant and branch isolation, must never make accounting decisions, and must stay replaceable as providers and contractual terms change.

PR-4 therefore adds extraction evidence only. It does not create a business transaction, invoke `post()`, create master data, send a message through a channel, or alter accounting, inventory, sales, purchases, or expenses.

## Decision

The system uses a provider-neutral `DocumentExtractionProvider` contract with explicit configuration validation, connection testing, and extraction methods. A server-owned registry accepts only OpenAI, Anthropic Claude, and Google Gemini adapters. The processing engine resolves providers only from the encrypted platform configuration; no request payload, tenant user, worker payload, or document metadata can select a provider or supply a credential.

The platform console keeps a single encrypted `document_ai` profile. It contains a central extraction-engine switch, the selected primary provider, up to two ordered fallback providers, fallback enablement, default confidence threshold and document language, global safe file/page/size controls, and a per-provider configuration. Each provider configuration has its own enablement state, model, encrypted API key, bounded connection and processing timeouts, bounded retry limit, allow-document gate, optional monthly operation/page limits per tenant, declared data-region/retention terms, and test-result metadata. The initial state is disabled, with no provider selected.

Custom endpoints are deliberately not exposed. Every adapter uses its vendor's official HTTPS endpoint. This prevents administrator-configured server-side request forgery, makes the egress destination reviewable, and avoids presenting an endpoint field as a guarantee of residency. A provider's declared region and retention terms are an operator accountability record; they do not replace a signed DPA, vendor configuration, or deployment review.

| Concern | Decision |
|---|---|
| Settings scope | Platform Administrator only. Tenant and branch overrides are deferred because PR-3 did not establish a document-center configuration hierarchy. |
| Secret storage | The existing encrypted `PlatformIntegrationSetting.configuration` cast stores provider API keys. API responses expose only a masked indicator. Audit events record field paths, never values; a password-confirmed write-only clear request removes a stored provider key. |
| Selection | Primary and fallback providers are unique registered keys. An active engine requires an enabled, configured primary provider. Fallback entries must likewise be enabled and configured. |
| Worker boundary | The job carries only trusted tenant, branch, file, run, and job UUID values. It reconstructs and clears contexts in `finally`. |
| Input boundary | Only `clean`, non-purged private files are read through `DocumentStorageService`. An adapter receives a value DTO and has no access to Eloquent models or workflow services. |
| Result boundary | Adapters return a provider-neutral, versioned evidence payload. The normalized result is retained as encrypted tenant evidence; raw provider responses and raw errors are not retained. |
| Processing sequence | A batch moves from `received` to `queued` only after all files are clean, processing and extraction settings are enabled, and the separately code-governed provider network gate is approved. PR-4 fixes that network gate to `false`; therefore no production run is scheduled or sent externally in this phase. |
| Fallback/retry | A provider is attempted up to its configured limit before the resolver moves to the next configured fallback. Each attempt is append-only operational evidence with safe codes and messages only. |
| Usage limits | A configured monthly operation/page limit is evaluated within the trusted operational scope. A quota exhaustion advances to the next fallback when available. Usage evidence includes a unique provider event key, document batch, model, pages, tokens, and processing duration; cost/currency/policy fields are nullable foundations only and are not calculated or posted. |

## Versioned normalization contract

Every successful adapter response normalizes to schema version `document-schema-v1`. The payload is evidence, not an approved transaction. It contains the detected document type, issuer/recipient/date/reference/tax fields, integer minor-unit monetary fields, optional line evidence with minor-unit amounts/page/bounding-box/confidence/source where available, the detected language, warnings, and a safe source summary containing the provider key and model. Malformed monetary values are rejected rather than silently normalized. It excludes credentials, HTTP headers, raw request bodies, raw response bodies, and provider-generated internal identifiers that could be used to retrieve tenant data.

The extraction result model is branch-scoped and encrypted at rest. A separate branch-scoped provider-attempt model records sequence, provider, model, status, safe error code/message, timestamps, reported tokens, and page count. Both are auditable evidence records; no direct update to their identity or source linkage is permitted after creation.

## Provider transport

The adapters use Laravel's HTTP client rather than vendor SDKs. This maintains a single timeout/error/redaction boundary and avoids binding the core module to three client libraries. The initial adapters send an in-memory base64 representation of the already-approved private file. The PR-2 limits remain the application gate; provider-specific request limits are a second bounded guard. The adapters use JSON-oriented prompts and validate the normalized shape before returning a result.

OpenAI's Responses API accepts file inputs and applies PDF vision processing to text and page images for capable models.[1] Anthropic supports visual PDF understanding for standard non-encrypted PDF files and documents request limits separately.[2] Gemini documents both inline PDF input and a Files API, with inline input appropriate for temporary single-use processing.[3] PR-4 deliberately uses inline single-use transport so it does not create a provider file-retention lifecycle before a dedicated governance decision.

## Threat model and controls

| Threat | Control |
|---|---|
| Cross-tenant or cross-branch extraction | Trusted worker context, `BranchScoped` operational records, model guards, and no user-controlled provider selection. |
| Malware or unapproved content sent externally | Extraction is gated by a final `clean` scan status and a non-purged private file. |
| Credential disclosure | Laravel encrypted storage, password-confirmed platform changes, masked API output, secret-path audit entries only, and no raw exception persistence. |
| SSRF or unreviewed data destination | Fixed official HTTPS endpoints; no custom endpoint override. |
| Provider outage or quota exhaustion | Per-provider bounded retries, ordered fallback, safe failure codes, and retained attempt evidence. |
| Prompt injection in uploaded documents | The adapter prompt treats the file as untrusted evidence, requests data only, and the output is normalized evidence without authority to mutate workflow beyond the worker-owned transition. |
| Provider response leakage | Raw response bodies are not stored or placed in workflow metadata. Only normalized evidence and safe counters are retained. |
| Extraction becomes accounting authority | No transaction-domain dependency, no `post()`, no journal or inventory write, and final state remains `needs_review`. |

## Activation and rollback

The deployment remains inert by default: the engine has no selected provider and is disabled, while the code-level provider network gate is fixed to `false` for PR-4. Consequently, saving a profile or attempting a connection test cannot make an external request. A later, separately approved activation phase must deliberately change that gate after legal, regional, contractual, credential, storage, queue, scanner, and operational approval. The existing document processing and scanner gates remain independently required.

Rollback first disables the central extraction switch. Queued jobs then create no new extraction runs; already recorded evidence remains auditable. If application code is rolled back, the new tables are removed only after the runtime is rolled back and after an operator confirms no retained evidence must be preserved for investigation. Disabling a provider does not erase its previous attempt/result evidence or key configuration; removing a secret requires an explicit credential rotation or a later governed deletion procedure.

## Tests required before merge

The backend test suite must cover encrypted/masked provider secrets, primary/fallback validation, password and Platform Administrator authorization, registry rejection of unknown providers, connection-test safe results, clean-file gating, context cleanup, retry/fallback order, quota behavior, safe error persistence, versioned result persistence, workflow transitions, and tenant/branch isolation. The frontend suite must cover secret omission/preservation, numeric normalization, provider ordering, translation-key parity, and production build success.

## Explicitly deferred

Tenant-owned keys, tenant/company/branch override records, provider-side deletion APIs, long-lived provider file uploads, cost pricing, retention purge jobs, matching, review APIs/UI, transaction draft creation, accounting posting, master-data creation, and paid Render infrastructure changes remain outside PR-4.

## References

[1] [OpenAI — File inputs](https://developers.openai.com/api/docs/guides/file-inputs)

[2] [Anthropic — PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support)

[3] [Google Gemini — Document understanding](https://ai.google.dev/gemini-api/docs/document-processing)
