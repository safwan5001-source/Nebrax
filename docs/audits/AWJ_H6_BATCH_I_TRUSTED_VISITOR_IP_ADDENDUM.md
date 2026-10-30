# H6 Batch I — Phase 1: trusted visitor identity (addendum to the Batch H decision record)

**Outcome: still not implemented. Fail-closed behaviour is retained.** New evidence narrows the question but does not prove provenance for *this* deployment. Read `AWJ_H6_BATCH_H_TRUSTED_CLIENT_IP_DECISION.md` first; this document only records what changed.

## 1. What a signed gateway→backend visitor identifier would and would not prove

A gateway-signed identifier (HMAC over `visitor | timestamp | host` with `STOREFRONT_GATEWAY_SECRET`) proves exactly one thing: **the value came from a holder of the secret (the storefront server), not from a browser or a direct API caller.** That half is solvable and testable.

It does **not** prove the value is the visitor's real address. That depends entirely on what the storefront server *received* from the network in front of it, and that is the unproven half. A signature would launder an unverified header into an authenticated-looking one — the exact trap the brief warns about ("a new client-IP header merely because the request contains it").

## 2. New evidence gathered this batch

| Evidence | Source | What it establishes | What it does not |
|---|---|---|---|
| Backend is deployed from `render.yaml` (Docker) with `FRONTEND_URL` described as "the UI domain **on Vercel**" and the gateway secret "set to the same value **on Vercel**" | `render.yaml` | The intended storefront host is Vercel | Not a live-environment record; the same repo also has a storefront `Dockerfile` and Railway-hosted backend evidence (Media-Storage S4 report: `awj.up.railway.app`, `nibras-api-production.up.railway.app`) |
| `storefront/vercel.json` exists and enables deployments for `main` and `preview/**` | `storefront/vercel.json` | Vercel deployment is configured | Does not say production DNS terminates at Vercel (a CDN/WAF could sit in front) |
| Vercel documents that it **overwrites `X-Forwarded-For` and does not forward external IPs** ("to prevent IP spoofing"); `x-real-ip` is identical to it; `x-vercel-forwarded-for` is identical but is **not** overwritten by a proxy placed on top of Vercel; trusted-proxy pass-through is an Enterprise opt-in | Vercel docs, *Request headers* (page last updated 2025-12-13) | If the storefront really is the outermost Vercel deployment, a visitor cannot choose the address the storefront sees | Vendor documentation, not an observation of this deployment; says nothing for Railway/Docker/other hosting of the same code, and a CDN in front would make every visitor appear as the CDN's address |
| The storefront currently forwards no visitor address at all | `storefront/src/lib/commerce/config.ts` | The gateway is a clean place to add one | — |
| Laravel reads `REMOTE_ADDR` only; `trustProxies` is deliberately off | Batch H record; `EdgeScheme` | Direct-API callers cannot influence limiter identity | — |

## 3. Why implementation stays stopped

Proving provenance needs **observation of the real chain**, not documentation of one vendor:
1. Which platform actually serves production storefront traffic, and whether anything (Cloudflare, WAF, another CDN) sits in front of it.
2. The values the storefront server really receives for `x-forwarded-for`, `x-real-ip` and `x-vercel-forwarded-for` from two source networks, including a client-forged `X-Forwarded-For`.
3. Whether the storefront→Laravel leg changes anything (it does not matter for a *signed* identifier, but it matters for Option B/C fallbacks).

None of that is obtainable from the repository or this environment. The Vercel statement would justify an implementation **only after** item 1 and 2 are confirmed for production; shipping before is the speculative fix the brief forbids, and shipping it "disabled by default" adds unexercised security-adjacent code with no way to test its real inputs.

## 4. Design ready to implement the moment evidence arrives (not built)

Unchanged in intent from Option A, tightened with the signature:
- **Gateway:** read the platform header named by an explicit setting (`STOREFRONT_VISITOR_IP_SOURCE` = `x-vercel-forwarded-for` | `x-forwarded-for:<hops-from-right>`; unset ⇒ send nothing). Validate as an IP. Send `X-Storefront-Visitor: <ip-hash-or-ip>`, `X-Storefront-Visitor-Ts`, `X-Storefront-Visitor-Sig = HMAC-SHA256(secret, "v1|"+visitor+"|"+ts+"|"+forwardedHost)`.
- **Laravel:** honour the visitor only when (a) the gateway secret already validated, (b) `config('storefront.visitor_identity.enabled')` is true, (c) signature verifies in constant time, (d) timestamp within ±60 s, (e) the host in the signature equals the resolved host. Anything else ⇒ today's behaviour (`REMOTE_ADDR`). Per-email and per-tenant limiters are untouched; the visitor replaces only the IP dimension of `storefront-buyer-login|verify|resend` and public-API limiting.
- **Tests required (mirroring this batch's negative suite):** forged unsigned header ignored; forged signature; replayed old timestamp; signature for another host/tenant; correct signature but feature disabled; missing secret ⇒ 404; direct API call ⇒ 404; multi-visitor traffic gets separate buckets; one visitor still capped; per-email cap intact.

## 5. Exact verification the operator must perform (checklist)

1. Confirm in the hosting dashboards which service answers `https://<store host>` in production and whether any CDN/WAF/proxy precedes it.
2. Deploy a temporary route handler (or read platform request logs) that returns, **at the storefront server**, `x-forwarded-for`, `x-real-ip`, `x-vercel-forwarded-for`, `forwarded`. Call it from two networks (office, mobile) with and without a forged `X-Forwarded-For: 1.2.3.4`.
3. Expected on Vercel as the outermost edge: the real client address, and the forged value absent. Record the evidence in the repo (a dated note under `docs/audits/`).
4. Owner chooses the source setting and approves enabling per environment.
5. Only then implement §4 and run the negative suite plus a staging smoke test.

## 6. What this batch changed for Phase 1

Only tests, added to `tests/Feature/StorefrontClientIpBoundaryTest.php` (now 7):
- direct API requests with a wrong, empty or absent gateway secret, or no gateway headers at all, get the uniform 404 for 100 attempts across spoofed headers and **never consume the legitimate gateway's limiter budget**;
- a rotated/mismatched secret fails closed even when a forged visitor header is present.

Already covered and unchanged: eight header families inert with the correct secret; identity is the connection address; per-email limit survives rotating claimed IPs; tenants independent; shared gateway bucket characterized (20/min per tenant). No production code changed.
