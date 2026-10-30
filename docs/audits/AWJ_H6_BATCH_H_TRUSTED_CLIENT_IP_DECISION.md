# H6 Batch H — P0a: trusted client-IP boundary (decision record)

**Outcome: not implemented — the production proxy chain cannot be established from the repository or this environment.**
Per the brief, no speculative forwarding-header fix was written. This record gives the verified facts, the unverified ones, the
options, a recommendation, and the exact evidence required to unblock activation. Today's *safe* behaviour is pinned by
`tests/Feature/StorefrontClientIpBoundaryTest.php`.

## 1. The problem (Codex finding on PR #1812, confirmed)
Every `store/v1` request reaches Laravel from the storefront (Next.js) server, so `$request->ip()` is the gateway's address for
**all** visitors. `storefront-buyer-login` therefore has, in effect, one IP bucket (20/min per tenant) shared by every buyer; the
per-email bucket (5/min) is unaffected. Impact is availability (a single actor can burn the shared bucket) — and the same
property already holds for the anonymous `EnforcePublicApiRateLimit` (30/min per IP) on all `store/v1` traffic.

## 2. Verified facts (with evidence)
| Fact | Evidence |
|---|---|
| The storefront forwards only `X-Storefront-Forwarded-Host` + `X-Storefront-Gateway-Secret` (+ buyer/cart identity); it forwards **no** client IP | `storefront/src/lib/commerce/config.ts` (`storefrontFetch`, `storefrontCartRequest`, `storefrontBuyerRequest`) |
| Laravel does **not** trust forwarding headers: `Request::ip()` is `REMOTE_ADDR`; there is no `trustProxies` configuration | repo-wide search; `app/Support/EdgeScheme.php` and the Media-Storage S4 report record the *deliberate* decision not to enable `trustProxies` because it touches Host/Forwarded handling that tenant resolution depends on |
| The gateway secret authenticates the *storefront*, not any client address | `config/storefront.php`, `ResolveStorefrontDomain`, `RequireStorefrontMutationGateway` |
| No browser-supplied header changes the limiter identity, with or without the correct gateway secret (8 header families tried: `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `CF-Connecting-IP`, `True-Client-IP`, `X-Client-IP`, `X-Storefront-Client-Ip`, `X-Originating-IP`) | `StorefrontClientIpBoundaryTest` (rotating spoofs still exhaust the one bucket; per-email limit survives rotating spoofs; the identity is the connection address) |
| Tenant buckets are independent; the shared-bucket behaviour is pinned as a characterization | same test file |
| Railway edge forwards `X-Forwarded-Proto` (observed by behaviour: http→https 301) | `AWJ-HORIZON-MEDIA-STORAGE-S4-IMPLEMENTATION-REPORT.md` |

## 3. NOT verified (and why a header fix would be speculative)
1. **Which proxies sit in front of the Next.js server** (platform edge only, or a CDN/WAF too) and whether each *appends to* or *overwrites* `X-Forwarded-For` / sets `X-Real-IP`. No document or config in the repo records the headers the storefront actually receives.
2. **How the storefront reaches Laravel**: the documented configuration is a **public URL** (`AWJ_COMMERCE_API_URL`, e.g. the Render/Railway API URL) — i.e. an additional edge hop that appends its own entries — versus a private internal URL. The repo shows both Render (first preview deployment) and Railway (later work, including `*.railway.internal` for the scanner); the live topology for the storefront→API leg is not stated anywhere.
3. **The number of trusted hops** (needed to pick the right entry — never the leftmost, which the client controls).
4. Whether the edge strips a client-sent `X-Forwarded-For`/`X-Real-IP` before the app sees it.
Without (1)–(4), any choice of "which XFF entry to believe" is a guess, and a wrong guess lets a client pick its own rate-limit identity.

## 4. Options
| | Option | Trust model | Pros | Cons / risk |
|---|---|---|---|---|
| **A** | Storefront computes the client IP from its own incoming request using a **configured trusted-hop count counted from the right**, sends it as `X-Storefront-Client-Ip`; Laravel honours it **only** on requests that carry the valid gateway secret, and otherwise uses `REMOTE_ADDR`. Limiters key on the resolved value; tenant/email limits unchanged | Trust anchored in the secret *and* a verified hop count | Restores a real per-visitor bucket; no global `trustProxies`; Host resolution untouched | **Requires §3 evidence**. A wrong hop count, or a platform that appends client-controlled entries, makes the value forgeable. The secret alone is not enough (it proves the sender is the storefront, not that the value it relays is true) |
| B | Laravel `trustProxies` with explicit proxy ranges | Trusted proxy CIDRs | Standard | Affects `Host`/scheme handling that tenant resolution relies on (previously rejected); needs the edge CIDRs; platform ranges can change |
| C | For gateway-authenticated requests, replace the IP dimension with a **tenant-wide cap + per-email cap** (policy change) | No client IP needed | Works today; topology-independent | Loses per-source brake: password spraying (1 try/account) is limited only by the tenant cap; the tenant cap is itself DoS-able. A policy decision, not a technical one |
| D | Signed anonymous visitor cookie as the bucket key | None | Easy | Rotatable by the client — no protection against a hostile client; only useful for fairness among honest ones |

## 5. Recommendation
Treat **A** as the target and **C** as a possible *interim policy* the owner may choose (per the repo's "policy is configured, not hard-coded" rule — it must be a setting, default = today's behaviour). Do **not** ship either until §6 is satisfied. Wholesale is disabled everywhere, so there is no live exposure while this waits.

## 6. Exact activation blocker and how to clear it
Evidence needed from **staging/production** (not obtainable from this repository):
1. From two different source networks, request the storefront and record, **at the Next.js server**, the received `x-forwarded-for`, `x-real-ip`, `forwarded` (platform HTTP logs or a temporary route handler) — to learn the hop count and append/overwrite behaviour.
2. Record the same headers and `REMOTE_ADDR` **at Laravel** for the storefront→API leg — to learn whether the API leg adds hops.
3. Send a client-forged `X-Forwarded-For: 1.2.3.4` and confirm whether it is stripped, overwritten or appended behind the real address.
4. Record the result as the configured hop count (`STOREFRONT_CLIENT_IP_TRUSTED_HOPS`) and the owner's choice A/C.
Then the implementation is small: a pure resolver `(remote_addr, header_chain, hops) → ip` (right-to-left, validated as an IP, fallback to `REMOTE_ADDR`), a gateway-secret-gated read in one place, limiter keys switched, and tests mirroring `StorefrontClientIpBoundaryTest` with the verified chain (spoofed leftmost entries, missing/short chains, multi-user traffic).

## 7. What is in this PR for P0a
Only `StorefrontClientIpBoundaryTest` (5 tests) and this record. No production code changed.
