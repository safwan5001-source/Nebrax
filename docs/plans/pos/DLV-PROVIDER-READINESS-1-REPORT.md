# DLV-PROVIDER-READINESS-1 — Official provider evidence and integration readiness

**Task:** `DLV-PROVIDER-READINESS-1`
**Nature:** evidence and documentation only. No adapter, credential, migration, route, or financial posting.
**Repository:** `safwan5001-source/Nebrax`
**Base SHA (`origin/main` at start):** `23a99b104b7b95e7616d4797075de453183696e6`
**Connector Core merge:** PR #1287, same SHA, message `feat(delivery): operational connector ingestion (DLV-CONNECTOR-CORE-1) (#1287)`
**Verification date:** 2026-10-11 (Asia/Riyadh). Raw fetches that completed in this pass were on 2026-10-10 UTC.
**PRE_MERGE_REVIEW:** not stamped in this file. A documentation-scope result belongs in the handoff after CI on the exact Head SHA. This packet is not a financial `PRE_MERGE_REVIEW: PASS`.

No provider is enabled, connected, live, or synced. No imported invoice, payment, journal, VAT, AR, COGS, inventory movement, settlement, commission, or provider receivable is authorized.

## 1. Executive summary

Connector Core is merged and remains an operational ingestion foundation. It does not authenticate HungerStation, Jahez, Mrsool, Keeta, Ninja, or The Chefz, and it does not make any of them financially postable.

This pass checked official public pages only. It did not obtain a named AWJ merchant agreement, issued sandbox credential, or frozen provider specification for any platform.

| Provider | Technical connector | Commercial / onboarding | Financial / legal evidence | Imported-order financial posting |
|---|---|---|---|---|
| HungerStation | OWNER_GATE | OWNER_GATE | BLOCKED | BLOCKED |
| Jahez | BLOCKED | OWNER_GATE | BLOCKED | BLOCKED |
| Mrsool | BLOCKED | OWNER_GATE | BLOCKED | BLOCKED |
| Keeta | OWNER_GATE | OWNER_GATE | BLOCKED | BLOCKED |
| Ninja | BLOCKED | OWNER_GATE | BLOCKED | BLOCKED |
| The Chefz | BLOCKED | OWNER_GATE | BLOCKED | BLOCKED |

Allowed status values are only `READY`, `BLOCKED`, and `OWNER_GATE` for the first three columns, and `READY` or `BLOCKED` for imported posting. Nothing is `READY`.

Public documentation is not an AWJ-held contract. Keeta has the most complete public protocol. HungerStation has a public Delivery Hero POS page that names Hungerstation (Saudi Arabia), plus a separate HungerStation developer portal and published restaurant terms. Neither is a credential or a test vendor that AWJ holds. Jahez, Mrsool, Ninja, and The Chefz have no official order-API contract in the sources read. Third-party integrator blogs are not contracts.

No adapter should start. The next dependency-ready Horizon task is not an implementation task.

## 2. Evidence methodology

Findings use only these labels:

| Label | Meaning |
|---|---|
| PROVEN | The cited official page states the claim, and this pass read that page or its raw markdown/HTML. |
| KNOWN | The claim is in a cited source, but this pass did not byte-verify the file (index extract, or a prior accepted PASS-7/PASS-8 record that this pass did not reopen). |
| UNKNOWN | Required fact was not established. It stays fail-closed. |
| NOT_FOUND | This pass looked on the official site or the named official URL and did not find the artifact. Absence on a public page is not proof that a private contract cannot exist. |
| CONTRADICTORY | Two official statements, or two parts of one official page, do not identify the same contract or the same legal name. Neither statement is selected as the implementation contract. |

Source types used: official developer documentation, official restaurant or consumer terms, official partner-signup page, official VAT-group PDF index, and rejected third-party integrator documentation. Confidence is high only for text read from the raw page in this pass.

This pass does not reopen `OD-DG-3-TAX-POINT` (Option D, accepted in PR #1233 at `b0c3574225531ed907991bd9c5f23a7e8f5d66bb`). It does not treat a webhook, Hub state, settlement transfer, or consumer invoice sentence as a tax point. PASS-8 remains the financial evidence contract. `UNKNOWN` still blocks the affected financial prerequisite.

Out of scope and not done: provider adapters, secrets, production configuration, schema, routes, permissions, Hub behavior changes, financial services, and any status other than the Connector Core `configured` / `disabled` pair.

## 3. Six-provider comparison

| Question | HungerStation | Jahez | Mrsool | Keeta | Ninja | The Chefz |
|---|---|---|---|---|---|---|
| Official order API or webhook page found | Public DH POS page and a separate HS developer portal. Not one frozen contract. | NOT_FOUND | NOT_FOUND | Public standard API and a separate Open Delivery guide | NOT_FOUND | NOT_FOUND |
| AWJ holds credentials and a test path | No | No | No | No | No | No |
| Auth matches Connector Core HMAC | No. DH overview says username, password, and secret. Plugin auth body not extracted. | No contract | No contract | No. Documented request signature is SHA-256 over URL + sorted parameters + AppSecret, plus OAuth bearer. | No contract | No contract |
| KSA merchant relationship on a public page | Partner signup form and restaurant terms | “Join Us”, Saudi Arabia only | Partnership marketing page | NOT_FOUND on the API pages read | Consumer terms name a Saudi CR. No developer signup found. | Restaurant application form |
| Named AWJ agreement | NOT_FOUND | NOT_FOUND | NOT_FOUND | NOT_FOUND | NOT_FOUND | NOT_FOUND |
| Imported financial posting | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |

## 4. Individual evidence packets

### 4.1 HungerStation

Technical: **OWNER_GATE**. Commercial: **OWNER_GATE**. Financial/legal: **BLOCKED**. Imported posting: **BLOCKED**.

Three public surfaces were read. They are not proven to be one API.

| Claim | Label | Source | Date | Source type | Confidence |
|---|---|---|---|---|---|
| Hungerstation (Saudi Arabia) is listed under Middle East/North Africa on the Delivery Hero restaurant POS page. | PROVEN | https://developers.deliveryhero.com/documentation/pos.html | Page read 2026-10-11. No publication date on the page. | Official developer documentation | High |
| Credentials are requested with a public PGP key. After local-representative approval they are shared encrypted and are composed of username, password, and secret. | PROVEN | Same URL, “Request Credentials” | 2026-10-11 | Official developer documentation | High |
| Indirect flow: the vendor accepts or rejects on the Delivery Hero Vendor App, then Integration Middleware forwards accepted orders to the POS. Direct flow is allowed “on a case by case basis” through a local point of contact. | PROVEN | Same URL | 2026-10-11 | Official developer documentation | High |
| The integration process tells the POS client to give a plugin URL to the local representative and to test orders from a test vendor whose details that representative shares. | PROVEN | Same URL | 2026-10-11 | Official developer documentation | High |
| Plugin and middleware technical specifications are linked to `https://integration-middleware.stg.restaurant-partners.com/apidocs/pos-plugin-api` (Authentication section linked) and `pos-middleware-api`. | PROVEN as links on the official page. The staging Redoc body was **NOT EXTRACTED** (no authentication text returned). | Same URL; Redoc fetch returned no content | 2026-10-11 | Official documentation link; staging host | High for the link. The signature algorithm is UNKNOWN. |
| Post-production text says some or all of an integration might be disabled when an article of “the implementation contract” is not fulfilled, and gives a working cancellation endpoint on the plugin as an example. | PROVEN | Same URL | 2026-10-11 | Official developer documentation | High |
| The HungerStation developer FAQ names Catalog API, Promotions API, Catalog SFTP, Promotions SFTP, Pelican picking, Partner API/Orders, webhooks, order statuses, and Sandbox Testing. | PROVEN | https://developer.hungerstation.com/en/documentation/faq/overview | 2026-10-11. No last-updated date. | Official developer portal | High |
| That FAQ is a partner catalog/picking surface. It is not, by itself, the restaurant POS contract on the Delivery Hero page. | PROVEN as a classification of what the FAQ lists. Whether AWJ restaurant-order ingestion uses Pelican or the DH plugin is UNKNOWN. | Same FAQ | 2026-10-11 | Official developer portal | High |
| Restaurant terms were last updated 6 August 2026. Products are menu items the second party sells through the first party’s platform. The second party must provide a tax invoice to the customer with the order. | PROVEN | https://hungerstation.com/sa-ar/general-terms-conditions-restaurant-contracts clauses 10.1 and 9.3 | Page states 6-أغسطس-2026; rechecked 2026-10-11 | Official restaurant terms | High |
| If there is a credit balance, the first party transfers it after matching, within 14 days after the end of the settlement month. The first party sends invoices due from the second party within 7 business days after month end. The percentage is calculated on order totals excluding VAT. Transfer may be refused to a bank account not in the official owner’s name. The second party must match an invoice and pay it within 7 days of receipt. | PROVEN | Same terms, clauses 1.7–3.7, 5.7, and 7.3 | 2026-10-11 | Official restaurant terms | High |
| Direct technical integration applies only “if the parties agree”, and the restaurant must implement the APIs approved by HungerStation. The terms do not publish endpoints, payloads, or a signature scheme. | PROVEN | Same terms, clause 2.10 | 2026-10-11 | Official restaurant terms | High |
| Partner signup asks for a commercial registration, tax certificate if any, Saudi national ID, authorization, IBAN certificate if any, product images, logo, menu, and branch coordinates, then vendor-portal access. No API, webhook, or sandbox section was on that form. | KNOWN | https://partner.hungerstation.com/ (Arabic signup form) | Browse 2026-10-11 | Official partner portal | Medium |
| VAT, fee-VAT treatment, tax point, and a named AWJ merchant agreement are not on the Delivery Hero POS page. | PROVEN as absence on that page | DH POS URL above | 2026-10-11 | Official developer documentation | High |
| PASS-8 HungerStation financial checklist remains MISSING / UNKNOWN. This pass did not close it. | KNOWN | `docs/plans/pos/DELIVERY-DECISION-PASS-8-DG-3-EVIDENCE-CONTRACT-REPORT.md` section 16 | PASS-8 access 2026-10-05; not reopened | Repository decision | High for the repository state |

Close paraphrase of the credential sentence, from the rendered POS page: after request approval, the local representative shares credentials encrypted with the PGP key from the request form, and those credentials are username, password, and secret.

What is still missing: a signed AWJ merchant agreement, issued non-production credentials, the test-vendor identity, written confirmation of indirect versus direct flow, a frozen spec version whose authentication section AWJ has read, and a statement that the first slice is Hub projection only. The restaurant terms are an ordinary published relationship, not that agreement, and they do not select a HungerStation event as the tax point.

### 4.2 Jahez

Technical: **BLOCKED**. Commercial: **OWNER_GATE**. Financial/legal: **BLOCKED**. Imported posting: **BLOCKED**.

| Claim | Label | Source | Date | Source type | Confidence |
|---|---|---|---|---|---|
| The English homepage offers “Join Us” for partners and home chefs, “Saudi Arabia Only”, and the address King Abdullah Road, Waha, Riyadh 12444. It does not offer a developer portal, API, webhook, or sandbox. | PROVEN | https://jahez.net/index-en.html | Search extract and page summary 2026-10-11 | Official marketing site | High |
| The terms page is a consumer terms page. It mentions cash on delivery and that purchases cannot be returned except for restaurant flaws. It is not a merchant API contract. | KNOWN | https://jahez.net/terms-and-condition.html | Browse 2026-10-11 | Official consumer terms | Medium |
| A file at `https://www.jahez.net/jahez-gazt.pdf` is indexed as a VAT Group Registration Certificate for شركة جاهز الدولية لتقنية نظم المعلومات, group number 310191627410003, effective 2021-04-01, monthly period. Direct download from this environment returned HTTP 403 (challenge page). | KNOWN | That PDF URL | Index extract 2026-10-11; byte download not completed | Official PDF, not re-downloaded | Medium |
| That certificate, if the index is accurate, proves a VAT-group registration. It does not prove the merchant invoice role, fee VAT, or a tax point. | KNOWN as a limit on the indexed text | Same | 2026-10-11 | Official PDF index | Medium |
| The careers site names subsidiaries including Marn. Marn is not an official Jahez order API. | KNOWN | https://career.jahez.net/ | Search extract 2026-10-11 | Official careers page | Medium |
| Official order API, webhook, signature, sandbox, store-mapping rule, and retry semantics | NOT_FOUND | jahez.net pages read | 2026-10-11 | Official site | High for absence on those pages |

Commercial onboarding is a public join path only. Technical implementation stays blocked until Jahez publishes, or privately issues, an official API contract and a test path. A private contract is UNKNOWN, not invented.

### 4.3 Mrsool

Technical: **BLOCKED**. Commercial: **OWNER_GATE**. Financial/legal: **BLOCKED**. Imported posting: **BLOCKED**.

| Claim | Label | Source | Date | Source type | Confidence |
|---|---|---|---|---|---|
| The partnership page says “When you directly integrate with us” and that menu information and photos can be provided through “the integration”. It specifies no endpoint, authentication, webhook, or sandbox. | PROVEN | https://mrsool.co/partnership/ | Raw HTML read 2026-10-11 | Official marketing page | High |
| Footer contact on that page: 1890 Abi Bakar As Siddiq Rd, Riyadh. Copyright line says 2026. | PROVEN | Same | 2026-10-11 | Official marketing page | High |
| Courier terms bind delivery-service providers (المندوب), not restaurant sellers. The company is شركة تطبيق مرسول للاتصالات وتقنية المعلومات, unified national number 7007295574. | KNOWN | https://s.mrsool.co/terms | Browse 2026-10-11. PASS-8 already refused these terms as proof of the restaurant sale. | Official courier terms | Medium |
| Official restaurant order API, webhook, signature, sandbox, invoice role, fee, and settlement file | NOT_FOUND | Partnership page and courier terms | 2026-10-11 | Official pages | High for those pages |

“Directly integrate” on a marketing page is not an API contract. Confidence in any API claim drawn from that sentence is low, and no adapter is justified.

### 4.4 Keeta

Technical: **OWNER_GATE**. Commercial: **OWNER_GATE**. Financial/legal: **BLOCKED**. Imported posting: **BLOCKED**.

Keeta’s public developer documentation is the most complete of the six. It is still not `READY`. AWJ does not hold the NDA, developer account, or test store. The pages read do not state that the protocol applies in Saudi Arabia. Two documentation families on the same docs host do not identify one webhook registration contract. Cancel and refund operations are documented and are out of scope.

Standard API documents read as raw markdown on 2026-10-11:

- https://api-docs.mykeeta.com/apis/standard/docs/intro.md
- https://api-docs.mykeeta.com/apis/standard/docs/webhook.md
- https://api-docs.mykeeta.com/apis/standard/docs/author.md
- https://api-docs.mykeeta.com/apis/standard/docs/basicintegrationguide.md
- https://api-docs.mykeeta.com/apis/standard/docs/orderintegrationguide.md
- https://api-docs.mykeeta.com/apis/opendelivery/integrating-with-keeta-api.md
- https://api-docs.mykeeta.com/apis/opendelivery/keeta-developer-portal.md

| Claim | Label | Source | Confidence |
|---|---|---|---|
| Signup is https://developers.mykeeta.com/#/signup. The team replies within 5 business days. An NDA is required before a developer account and a test-store account. SIT self-test, a SIT review, brand registration, and mandatory per-brand production UAT follow. Brands that fail UAT are not permitted to launch. | PROVEN | intro.md | High |
| No Saudi Arabia, KSA, or GCC restriction or applicability is stated on the intro, webhook, authorization, basic, order, Open Delivery, or developer-portal pages read. | PROVEN as absence | Those markdown files | High |
| Outbound calls must include `sig`. The documented construction is SHA-256 over UTF-8 of the URL, `?`, ASCII-sorted `key=value` pairs joined by `&`, and the AppSecret appended with no extra separator. `sig` is excluded. Empty parameters are included. JSON values are not sorted internally. The worked example is an outbound call to `https://open.mykeeta.com/...`. | PROVEN | author.md sections 2–3 | High |
| That construction is not Connector Core HMAC (`X-AWJ-Signature: t=,v1=` over `timestamp.rawBody`). | PROVEN by comparison with the merged core report | author.md and `DLV-CONNECTOR-CORE-1-IMPLEMENTATION-REPORT.md` | High |
| Webhook pushes include `sig`, and developers must verify it using the Authorization Guide. The webhook field list is `sig`, `eventId`, `appId`, `messageId`, `shopId`, `message`, `timestamp`. A separate worked example that signs the merchant-hosted URL was not in the guide. | PROVEN that verification is required. The exact inbound canonical string is UNKNOWN until Keeta confirms it. | webhook.md and author.md section 1 | High / UNKNOWN for the inbound string |
| Webhooks are HTTPS POST, `application/json`, UTF-8. An empty heartbeat packet must get a success response. Success is `code` 0. Retries are “typically” up to 3 times at 1-minute intervals. Idempotency is required; the retry note says to dedupe using the order id. `messageId` is also defined as the message’s unique identifier. | PROVEN | webhook.md | High |
| Documented order event ids include 1001 placement, 1002 acceptance, 1003 completion, 1004 cancellation, 1005 refund initiation, 1006 delivery status, 1007 partial refund. The webhook page also lists 1101 store business hours, 1102 store status, and 1201 batch product image binding. | PROVEN | orderintegrationguide.md and webhook.md | High |
| Outbound order paths under `/api/open/order/` include confirm, get, prepare, cancel, agree, reject, collect, and partial-refund preview/apply. Cancel says to be cautious “to prevent unintended financial losses.” | PROVEN | orderintegrationguide.md | High |
| The order guide says webhook 1001 includes order details and “merchant settlement information”. | PROVEN as that phrase. It is not a settlement schema, VAT rule, or tax point. | orderintegrationguide.md section 2.1.1 | High |
| Chain brands share one access token. A single store has its own. The example `expiresIn` is 7776000 and is described as 90 days. Access and refresh tokens expire together. Refresh is `POST https://open.mykeeta.com/api/open/base/oauth/token` with `appId`, `refreshToken`, `timestamp`, `grantType` `refresh_token`, and `sig`. After a successful refresh, the guide prohibits more than one refresh per minute and keeps the previous token valid for 60 minutes. Refresh failures should be retried 3 to 5 times. | PROVEN | basicintegrationguide.md | High |
| Example token strings and example signatures in those guides are documentation samples. They are not AWJ credentials and are not copied here. | PROVEN | basicintegrationguide.md, author.md, webhook.md | High |
| Open Delivery’s integrating guide uses an access token, maps an internal `merchantId` to a Keeta `merchantId`, registers webhooks with Merchant Onboarding, places a test order in the Keeta Test App, and then expects a `PLACED` event by webhook or polling. | PROVEN | integrating-with-keeta-api.md | High |
| The developer portal says regular webhooks should be registered with the Open Delivery “Register / Update Merchant endpoint” method, while authorization webhooks 1301 (new authorization) and 1302 (cancellation) are configured in the portal. It also describes a test-store tool that requires an application first. | PROVEN | keeta-developer-portal.md | High |
| Standard webhook.md also says the callback URL can be set in Application Management or by `POST https://open.mykeeta.com/api/open/base/callback/url/set`. | PROVEN | webhook.md | High |
| Those two registration instructions are not the same contract. `PLACED` is not mapped by Keeta, on the pages read, to event id 1001. | CONTRADICTORY / unresolved | webhook.md versus the Open Delivery pages | High that both exist. Neither is selected. |

Commercial readiness is owner-gated because signup and an NDA are the published path, and AWJ has not signed that NDA. Financial and imported posting stay blocked. PASS-8 already recorded Keeta as `UNKNOWN` / BLOCKED for imported financial posting. The new operational protocol does not fill the tax-point, invoice-role, fee-VAT, or settlement-document gaps. The words “merchant settlement information” inside an order notification do not authorize settlement posting.

### 4.5 Ninja

Technical: **BLOCKED**. Commercial: **OWNER_GATE**. Financial/legal: **BLOCKED**. Imported posting: **BLOCKED**.

This is the Saudi consumer app at ananinja.com. It is not NinjaTrader, ninja.ng, or Paylink. Those names were excluded and are not sources.

| Claim | Label | Source | Date | Source type | Confidence |
|---|---|---|---|---|---|
| The page titled as a privacy-policy URL contains “Terms and conditions for using the Ninja application”. The service-provider definition names Advance Technology Company for Information Technology, Saudi commercial registration 2052101911. The introduction of the same extract says “Advance Information Technology LLC”. | KNOWN, and the two legal-name wordings are CONTRADICTORY inside that extract. The CR number is taken from the definition paragraph. | https://ananinja.com/sa/en/privacy-policy | Search extract 2026-10-11. A direct browse did not return the terms body. | Official consumer terms | Medium |
| Merchant means the provider of the item. The application displays merchant goods, and the service provider’s own team delivers them. | KNOWN | Same extract | 2026-10-11 | Official consumer terms | Medium |
| API, webhook, sandbox, signature, and a merchant-developer signup | NOT_FOUND | That terms extract and restaurant menu URLs, which are consumer menus | 2026-10-11 | Official consumer site | Medium for the terms extract |

PASS-8 already says these consumer terms do not prove invoice responsibility or a tax-point mapping. That conclusion is not reopened. A commercial relationship would have to be requested; none was found as a developer onboarding page.

### 4.6 The Chefz

Technical: **BLOCKED**. Commercial: **OWNER_GATE**. Financial/legal: **BLOCKED**. Imported posting: **BLOCKED**.

| Claim | Label | Source | Date | Source type | Confidence |
|---|---|---|---|---|---|
| https://thechefz.co/ar/apply-restaurant/ is a “New Partner Registration” form (basic information, company information, company papers, social links, location). The fetch did not show API, webhook, POS, credentials, invoice, or commission fields. | KNOWN | That URL | Browse 2026-10-11 | Official onboarding form | Medium |
| The chef FAQ distinguishes pickup (yellow) from driver delivery. It is operational only. | KNOWN | https://thechefz.co/ar/faq-chef/ | Browse 2026-10-11 | Official FAQ | Medium |
| Consumer terms include a sentence that the user is given an electronic copy of the order invoice issued by The Chefz (فاتورة طلبه صادرة من ذا شفز), plus wallet and compensation language. | KNOWN | https://thechefz.co/ar/terms-and-conditions-ar/ | Browse 2026-10-11 | Official consumer terms | Medium |
| That sentence does not prove principal versus billing-on-behalf, and it is not a tax point. PASS-8 already classified The Chefz invoice language as not sufficient. | KNOWN | PASS-8 section 17, carried forward. This pass does not reopen it. | 2026-10-05 record; quote rechecked 2026-10-11 | Repository decision plus consumer terms | High for the boundary |
| A Chefz-owned API specification, webhook, signature, sandbox, and store-mapping rule | NOT_FOUND | The three official URLs above | 2026-10-11 | Official site | Medium |
| Omniful’s integration document tells Omniful customers to request credentials from Chefz support. | KNOWN and rejected | https://www.omniful.ai/docs/integration/chefz-integration-document | Search extract 2026-10-11 | Third-party integrator documentation | Low as an API contract. It is not used. |

`DLV-EVIDENCE-1` already noted Foodics-ecosystem mentions for some providers. Those mentions remain ecosystem evidence. This pass does not promote them, and it does not copy third-party field names into a contract.

## 5. Connector Core compatibility

Merged behavior used for this comparison is the one recorded in `docs/plans/pos/DLV-CONNECTOR-CORE-1-IMPLEMENTATION-REPORT.md` on the base SHA above. This task does not change that code.

Reusable, once a future authorized adapter exists:

- encrypted secret storage and one-time display;
- trusted `(platform_key, external_store_id)` to tenant, profile, and branch, immutable after create;
- ingress status only `configured` or `disabled`;
- idempotency, replay, and authoritative payload conflict;
- Delivery Hub projection without financial side effects;
- `sales.pos` and subscription gates;
- branch visibility;
- `operated_by` actor, with no silent fallback when that user is ineligible;
- a neutral ingress envelope.

Those pieces do not authenticate any provider.

Gaps, none of which are implemented here:

| Gap | Evidence | Consequence |
|---|---|---|
| Authentication | Core verifies AWJ HMAC. HungerStation’s public POS overview uses username, password, and secret issued under PGP. Its plugin authentication section was not extracted. Keeta’s public request signature is SHA-256 over URL + sorted parameters + AppSecret, and merchant calls also use an OAuth bearer token. | HMAC is not the provider protocol. An adapter would have to terminate the provider scheme in the backend and only then produce the neutral envelope, or a later task would add a verifier. Neither is authorized. |
| Direction | Core ingestion is an inbound POST to AWJ. The Delivery Hero plugin is an adapter that Delivery Hero calls. Keeta both pushes webhooks to a merchant URL and requires outbound confirm, prepare, and other calls. | Core is not a plugin host and is not an outbound provider client. |
| Store identity | Core’s mapping key is `(platform_key, external_store_id)`. Keeta standard docs use `shopId` and separate chain versus store tokens. Open Delivery uses `merchantId`. Delivery Hero test vendors are issued by a local representative. The other four providers have no published mapping rule. | No identifier is assumed to be the core external store id. |
| Idempotency | Core identity is `(account, event_id)` plus a 300-second window for a new event. Keeta defines `messageId`, says retries are typically three times at one-minute intervals, and also says to dedupe by order id. | The keys are not the same. A naive translation could reject a late provider retry or collapse distinct messages. Core is not changed to fit either behavior. |
| Catalog, availability, and status callbacks | Present in the DH and Keeta public docs. Absent from core. | Out of scope. |
| Cancellation and refund | Keeta documents cancel and partial refund and warns of financial loss. DH post-production text mentions a plugin cancellation endpoint. | Not implemented. Not a financial correction path. |

HMAC remains compatible only as AWJ’s internal ingress after a provider adapter exists. It is not a substitute for provider authentication.

## 6. Financial and legal blockers

Preserved from PASS-7 and PASS-8, and not reopened:

- `OD-DG-3-TAX-POINT` Option D is architecture only.
- The five implementation gates stay open: `DG-3-EVIDENCE-SNAPSHOT`, `DG-3-POLICY-DERIVATION`, `DG-3-VAT-PROJECTION`, `DG-3-ACCOUNTING-REPRESENTABILITY`, and `DG-3-FINANCIAL-TRANSITION`.
- `DG-3-PROVIDER-READINESS` is not closed by this packet. Every provider failed at least one of official contract, AWJ-held test path, and financial evidence.
- Hub state, webhook arrival, ingestion time, and settlement transfer are not a customer-sale tax point.
- A technically documented provider can remain financially blocked. Keeta is that case.
- HungerStation’s published terms support only the ordinary facts already recorded in PASS-7: the restaurant sells the menu items, supplies the customer tax invoice, electronic collections are reconciled and transferred, and HungerStation invoices its own fees. They do not identify a tax-point event.
- Jahez’s indexed VAT-group certificate does not identify the merchant’s invoice role.
- Mrsool courier terms do not prove the restaurant sale.
- Ninja’s consumer terms identify a merchant and a delivering platform team, not an invoice or tax-point map.
- The Chefz consumer invoice sentence does not prove principal versus billing-on-behalf.
- No settlement sample, fee-VAT treatment, commission base, or agent/principal opinion was accepted for any provider.

Imported-order posting remains `BLOCKED` for all six. This packet does not authorize commission, settlement, reconciliation, VAT, or a financial transition command.

## 7. Owner action checklist

Do not send secrets, tokens, or private keys in a repository issue or in this report. Store anything issued later through the existing server-side secret path only after a separately authorized task.

| Provider | What the owner must obtain before any connector task |
|---|---|
| HungerStation | A named merchant agreement; written confirmation of which surface applies (Delivery Hero restaurant POS plugin, HungerStation Partner API/Pelican, or another issued spec); indirect versus direct flow approval; a frozen spec version and its authentication section; a test vendor and non-production credentials issued to AWJ; store-id mapping rules; a written limit that the first slice is operational Hub projection only. |
| Keeta | Written confirmation that the public standard API, the Open Delivery API, or a named other version applies to the Saudi operation AWJ would use; a signed NDA; a developer account and test store issued by Keeta; one chosen webhook registration method; a worked inbound signature example; confirmation that `shopId` or `merchantId` is the store key; the same Hub-only written limit. Do not start from the cancel or refund endpoints. |
| Jahez | An official API or partner-integration contract, or a written statement that none will be issued. A public “Join Us” submission is not that contract. The VAT-group PDF is not that contract. |
| Mrsool | An official restaurant integration contract. The partnership page and the courier terms are not that contract. |
| Ninja | A merchant agreement and an official integration contract with Advance Technology Company for Information Technology (CR 2052101911), after the legal-name wording on the consumer page is confirmed. Consumer terms are not that contract. |
| The Chefz | An official POS or partner API specification from The Chefz, plus a merchant agreement. The application form is not a specification. Omniful, Foodics, and other integrators are not The Chefz. |

For every provider, financial work additionally needs the PASS-8 packet: supplier identity and VAT status, invoice responsibility, collection role, component-level tax-point evidence, fee and fee-VAT documents, and settlement samples. That list is not a request to start financial implementation.

## 8. Recommended first provider

No provider is recommended for implementation.

If the owner funds one evidence track first, use **HungerStation**. The horizon already names `DLV-HUNGERSTATION-1` first, the Delivery Hero POS page explicitly lists Hungerstation (Saudi Arabia), and the restaurant terms are a Saudi merchant relationship document. The track is still `OWNER_GATE`: credentials, the test vendor, direct-flow approval, and the unread plugin authentication section are not held. Do not mark it `READY`, and do not open an adapter branch.

**Keeta** is the alternate evidence track, not a second implementation. Its public protocol is clearer, and its signature, retries, and test-store path are written down. It does not state KSA applicability, it requires an NDA and a Keeta-issued test store, and its two webhook-registration guides conflict. Those are owner gates, not reasons to code.

Do not start Jahez, Mrsool, Ninja, or The Chefz. Do not start commission, settlement, VAT, or imported-order posting for any provider.

## 9. Next dependency-ready Horizon task

None. `DLV-PROVIDER-READINESS-1` was the evidence packet that became ready after Connector Core merged. Completing it does not promote `DLV-HUNGERSTATION-1`, `DLV-KEETA-1`, or any financial task.

The next honest step is owner collection of the section 7 evidence. A later connector task is dependency-ready only when that evidence includes both an official contract and a test path AWJ actually holds, and even then the first slice remains operational Hub projection unless a separate financial authorization exists.

## 10. Remaining decision gates

| Gate | State after this packet |
|---|---|
| `OD-DG-3-TAX-POINT` | Accepted architecture only. Not a production flag. |
| Five DG-3 implementation gates | Open. |
| `DG-3-PROVIDER-READINESS` | Open. Assessed, not satisfied. |
| `DG-6-TRIGGER` imported invoice command | Open. Blocked. |
| `DG-7` external vault | Open. Untouched. |
| `DLV-HUNGERSTATION-1`, `DLV-KEETA-1`, and the other native connectors | Not dependency-ready. |
| `DLV-COMMISSION-1`, `DLV-SETTLEMENT-1`, `DLV-RECON-1`, `DLV-REFUND-1` | Blocked. |
| Provider enablement, Connected / Live / Synced | Not introduced. |

## 11. Reviews

### Evidence self-review

- No provider is `READY`.
- No endpoint, payload field, signature, sandbox credential, or retry rule was invented where the source did not state it.
- The Delivery Hero plugin authentication body is recorded as not extracted.
- Keeta demo tokens and demo signatures were not copied.
- The Keeta standard API and Open Delivery guides were not merged into one contract.
- HungerStation’s three public surfaces were not merged into one contract.
- Third-party Chefz material was rejected.
- Jahez VAT facts are labeled `KNOWN` because the PDF download was challenged.
- Ninja’s legal-name wording is labeled contradictory instead of being silently normalized.
- Connector Core was not edited.

### Source-quality review

Raw page or markdown was read for the Delivery Hero POS page, the HungerStation developer FAQ, the HungerStation restaurant terms, the seven Keeta markdown files listed above, and the Mrsool partnership page. Partner signup, Jahez homepage and terms, Ninja terms, The Chefz form, FAQ, and consumer terms, the Jahez VAT PDF, and the Omniful page were browser or search extracts and are marked `KNOWN` or otherwise downgraded. The staging plugin Redoc was not usable.

### AWJ Guardian review

| Risk | Result |
|---|---|
| Enabling a provider because a public page exists | Rejected. Status is `OWNER_GATE` or `BLOCKED`. |
| Treating HMAC as the provider’s signature | Rejected in section 5. |
| Starting cancel, refund, commission, or settlement from a documented endpoint or a terms clause | Rejected. |
| Using a consumer invoice sentence as supplier identity | Rejected. PASS-8 stands. |
| Asking for a secret inside the report | Not done. |
| Changing runtime, schema, or permissions | Not done. |

### Documentation consistency

- Horizon section 5.1 no longer says Connector Core is unmerged.
- The horizon update does not promote a native connector.
- `DLV-CONNECTOR-CORE-1-IMPLEMENTATION-REPORT.md` stays a historical implementation report. Its “not merged” wording is not rewritten.
- PASS-7 and PASS-8 are cited and not reopened.

**Merge != Deploy.** No production release is authorized.
