# AWJ Animated Media — Phase 2 / P2-0 Implementation Report
## Storefront media proxy: bounded buffering + concurrency protection (no video)

| | |
|---|---|
| Slice | **P2-0** of `docs/reports/AWJ_ANIMATED_MEDIA_PHASE2_READINESS.md` (that report lives on PR #1551; its status update recording the approvals below is committed there) |
| Branch | `claude/awj-p2-0-media-proxy-hardening` |
| PR | [#1552](https://github.com/safwan5001-source/Nebrax/pull/1552) (targets `main`; **not merged, not deployed**) |
| Base SHA | `1296e1ce79a339f94336f92c3258ec5fb0d815e6` (`origin/main`) |
| Code head | `d38d7ea9a86bffd6aa4a84fc1e870b6244b18cd6` |
| Final head | this docs-only commit (see PR head) |
| Scope guard | No video, AVIF or WebM. No migration, API-contract change, R2 credential change or infrastructure. Laravel-served image bytes are **still buffered, never streamed**. |

## 1. Owner decisions recorded (readiness report, PR #1551)
- **Architecture B2** approved architecturally (Laravel authorises; Next.js streams video bytes from R2 with server-side signed URLs).
- **Poster design P2** approved (the poster belongs to the video asset; no `poster_media_id` migration).
- **Animated WebP:** manually tested successfully by the owner on an iPhone, in the Canvas and on the published storefront — *owner-reported, not independently verified here*.
- All other real-device and security acceptance tests remain **unverified** unless independently evidenced.
- **These approvals do not authorise video rollout.**

## 2. Review of the proxy before the change (`storefront/src/app/api/storefront/media/customizer/[id]/[file]/route.ts`)
Validated id/file against the contract, forwarded `Host` + gateway secret to the Laravel origin, passed through 404, mapped everything else to 502, set the only public `Cache-Control` and `nosniff`, and answered `new Response(await upstream.arrayBuffer())`. Gaps for Phase 2:
1. **Unbounded body**: whatever the origin sent was buffered; `Content-Length` was never checked.
2. **Unbounded fan-out**: every visitor request became a simultaneous Laravel (Apache prefork) request.
3. **No deadline and no cancellation**: a hung origin held a request forever; a visitor leaving did not cancel the origin call.
4. **Unhandled failures**: a network error threw out of the handler (framework error path, message not controlled by us).

## 3. What changed
| File | Change |
|---|---|
| `storefront/src/lib/commerce/media-proxy-guard.ts` (new) | `readBodyBounded` (counts bytes actually received; refuses a declared `Content-Length` over the bound without reading; cancels the origin stream when the bound is crossed), `createConcurrencyGate` (global + per-visitor-host limit, bounded queue, wait deadline, abort-aware, idempotent release), `mediaProxyLimits` (defaults + clamped optional env overrides) |
| `…/customizer/[id]/[file]/route.ts` | Wraps the origin round-trip in the gate; passes an abort signal (visitor disconnect **or** deadline) to `fetch`; reads the body via `readBodyBounded`; **one** uniform failure shape; `finally` always releases the slot. Param validation, headers forwarded, cache/ETag/`nosniff`, 200/304/404 semantics, and the buffered `Response` body are unchanged. |
| `…/route.test.ts`, `media-proxy-guard.test.ts` (new) | +38 tests (§5) |
| `docs/plans/store/s0-spikes/streaming/proxy-bounded-memory.mjs` + `results/proxy-bounded-memory.jsonl` | Reproducible old-vs-new measurement (§6) |

### Defaults (all overridable by optional env vars, clamped; absent/malformed ⇒ default)
| Setting | Default | Env | Why |
|---|---|---|---|
| Max buffered body | **8 MiB** (**floor 6 MiB** = the producer ceiling, §10.4; ceiling 32 MiB) | `STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES` | Largest legitimate body is the Laravel-side ceiling for a generated file, `storefront_media.variant_max_bytes` = 6 MiB (§10 — the original wording “ladder files are far smaller” was wrong), or the sanitised animation ≤ 5 MiB (`animated.max_bytes`). 8 MiB leaves headroom above both. |
| Concurrent origin round-trips | **16** (1–256); one host ≤ half | `STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT` | Bounds Laravel workers used by this proxy per instance. **Fitted into the read-memory budget below** — a request above what the budget allows is lowered, never honoured (§10). The earlier note “16 × 8 MiB = 128 MiB worst case” understated the read phase: the received chunks and the assembled copy coexist, so the bound is **× 2 = 256 MiB** (measured +224–297 MiB RSS over baseline at the defaults). |
| Read-memory budget | **256 MiB** (32 MiB – 512 MiB hard ceiling) | `STOREFRONT_MEDIA_PROXY_MAX_BUFFERED_BYTES` | Invariant `maxConcurrent × maxBodyBytes × 2 ≤ budget ≤ 512 MiB`. Defaults (16 × 8 MiB × 2) equal the default budget, so default behaviour is unchanged. |
| Delivery deadline | **120 s** (10–600 s) | `STOREFRONT_MEDIA_PROXY_DELIVERY_TIMEOUT_MS` | P2-0b: longest a finished, buffered response may stay outstanding before it is cut off and its budget share freed (§10.5). |
| Queue / wait | 64 waiters (0–1024), 4 s | `STOREFRONT_MEDIA_PROXY_MAX_QUEUE` | Smooths a page-load burst, then sheds with `503` + `Retry-After: 2`, `no-store`. |
| Round-trip deadline | **15 s** (1–120 s) | `STOREFRONT_MEDIA_PROXY_TIMEOUT_MS` | A stuck origin can never hold a slot. |

No env var is set anywhere by this PR (no Railway change); the defaults apply until the owner decides otherwise.

## 4. Behaviour matrix
| Situation | Before | After |
|---|---|---|
| Normal GIF/WebP/JPEG | 200, buffered, public cache | **identical** (verified A/B on built servers, §5) |
| Origin 404 / other non-2xx | 404 / 502, `no-store` | identical, body-less; origin body cancelled |
| Origin `Content-Length` > bound | buffered fully | **502**, body unread, `no-store` |
| No `Content-Length` (chunked) over bound | buffered fully | **502** after ≤ bound + one chunk |
| `Content-Length` understated | buffered fully | **502** at the bound |
| Overstated but body ≤ bound | 200 | 200 (real size counts) |
| Network error / mid-body failure | exception → framework error | **502**, empty body, no URL/host/secret/stack |
| Hung origin | waits forever | **502** at the deadline; slot freed |
| Visitor disconnects | origin call continues | origin call **aborted**; slot freed |
| Burst beyond capacity | unbounded Laravel fan-out | queue, then **503** + `Retry-After`; origin load ≤ limit |
| Bad id/file, no Host | 404, no origin call | identical; **no slot taken** |

## 5. Tests and results
| Check | Result |
|---|---|
| `media-proxy-guard.test.ts` (19): limit parsing/clamps; `Content-Length` parsing; exact-bound accept / bound+1 refuse; empty body; declared-oversize refused unread; chunked no-CL bounded and cancelled early; understated CL; overstated CL; mid-stream error; gate grant/queue/idempotent release; queue-full shed; wait deadline then recovery; disconnect leaves queue; **noisy-neighbour host cap**; full recovery after a burst with failures | ✅ |
| `route.test.ts` (+19 → 28): normal GIF/animated WebP/JPEG/WebP byte-for-byte + unchanged headers; still buffered (not the origin stream); exact bound; oversize via CL / no CL / understated CL / mid-body failure → uniform 502; concurrency: wait → shed 503 + `Retry-After` → queued request runs → fresh request OK; slot frees after origin failure, visitor abort (origin signal aborted), deadline (real 1 s); contract-rejected requests take no slot; 304 round-trips; **no leak** (network error, 5xx with revealing body/headers, 401/403/429 collapse to 502, 404 stays 404, oversize warning carries no host/URL/secret); per-request host + gateway secret still forwarded verbatim, none sent when unset; animated file still refuses a transform key | ✅ |
| Full storefront suite | ✅ 211 files passed / 15 skipped; **2,861 tests passed** (was 2,823; +38) |
| `tsc --noEmit`, `biome check` on all touched files | ✅ |
| `next build` (storefront) | ✅ |
| **Real built server** (`.next/standalone`, fake Laravel origin): 10 KB image 200 with correct headers; 10 MB with CL → 502; 10 MB chunked → 502; origin 500 with revealing body → 502 empty; stuck origin → 502 at deadline; 20 parallel slow requests with limit 4/queue 2 → **16 × 503**, others served/timed out; immediate recovery → 200; server log contains no secret/URL | ✅ |
| **A/B of response headers**, old build vs new build, same request | ✅ identical (`cache-control`, `content-type`, `etag`, `x-content-type-options`, framing) |
| Mutation check: the old route against the new deadline test | the test never completes (old code has no deadline) |
| Backend / web | not applicable — no PHP or `web/` file changed |

## 6. Security and performance findings
Measured with `proxy-bounded-memory.mjs` (100 slow visitors, 250 KiB/s, same machine as S0; RSS of the proxy process):

| Origin response | Old (unbounded) peak RSS | P2-0 peak RSS | Outcome with P2-0 |
|---|---|---|---|
| 5 MB normal image, with `Content-Length` | 543 MiB | 600 MiB | 100 × 200 (unchanged behaviour) |
| 100 MB body, no `Content-Length` | **2,044 MiB** | **295 MiB** | 100 × 502, fast |
| 100 MB body, with `Content-Length` | **2,383 MiB** | **191 MiB** | 100 × 502, fast |

**Findings**
1. **Fixed — memory exhaustion by an oversized/misbehaving origin body** (a corrupt or hostile object, a Laravel bug, or a future large file such as video accidentally routed here): 2.0–2.4 GiB → < 300 MiB.
2. **Fixed — unbounded origin fan-out**: ≤ 16 simultaneous Laravel requests per storefront instance (≤ 8 per host), with queueing and shedding. This is the part that protects the shared Apache pool the ERP API runs on.
3. **Fixed — hung origin / vanished visitor** now free their slot (deadline + abort), so the gate cannot leak slots.
4. **Fixed — information leakage**: every failure is the same empty, uncached response; the only diagnostic is a server-side warning with media id, file and limit (no host, URL or secret).
5. **Fixed in P2-0b (§10.5) — delivery-phase memory.** This was a confirmed P1 (the gate released when the handler returned, before a slow visitor had drained the buffered body). The same memory budget now also covers outstanding response delivery, with measurements on the real built server. The original paragraph said this needed a behaviour change; Next's framing was re-checked on the built server and is byte-identical (see §10.5).
6. **Limits are per Node instance** (the storefront runs 1 replica); with more replicas the effective global limit multiplies.
7. **The per-host cap is fairness, not a security boundary**: the key is the visitor-supplied `Host`, so an attacker rotating Host values avoids the per-host cap but is still held by the global cap and queue.
8. **Defaults are reasoned, not tuned on production traffic.** Under a real traffic spike a legitimate visitor can now see `503` where before the request would have queued inside Laravel; the browser shows a broken image until reload. If monitoring shows shedding at normal load, raise `…MAX_CONCURRENT` (an env change, owner decision).
9. **Tenant isolation / publication gating unchanged**: tenant and storefront are still resolved only by the origin from the forwarded host; the Published-reference gate still runs on every call; the gate key is only a counter label, nothing is cached or shared between hosts.

## 7. Risks and remaining work
| Risk | Level | Note |
|---|---|---|
| Delivery-phase memory (finding 5) | Low (was Medium) | Bounded by the budget since P2-0b (§10.5); residual: allocator overhead ≈ 1.2×, kernel socket buffers, and availability under a coordinated slow-client attack (503 until the 120 s deadline) |
| Operator raises the read budget (≤ 512 MiB hard ceiling) | Low | Explicit opt-in; RSS ≈ 1.2× budget measured; the Railway plan memory is not known to this repo — keep the default unless it is |
| 503 shedding under legitimate bursts | Low–Medium | Tunable by env; observe after deploy |
| New code on the public image path | Low | 38 tests, A/B header identity, real-runtime smoke; kill-switch is reverting the PR (no data/config involved) |
| Merging redeploys the storefront from `main` (Railway auto-deploy) | Process | Merge deliberately; effects are limited to image delivery behaviour described above |
| Real-device and real-R2 behaviour | Unverified | Unchanged by this slice |

## 8. GO / NO-GO for the next slice
**GO to merge P2-0** once the PR's required checks are green (this is a safety improvement with no product change; recommended before any large asset can reach the proxy).

**Next slices (none authorised by this PR):**
| Slice | Recommendation | Needs |
|---|---|---|
| **V0** delivery spike (R2 presigned + Range, authorise endpoint cost) | **GO** to prepare | R2 test bucket + scoped token; AMEND-1 clarification ADR |
| **A0** AVIF image change | **GO** to prepare, flag-off | Owner approval of the Dockerfile change |
| **P2-0b** delivery-phase memory budget | **Done in this PR (§10.5)** | — |
| V1–V7 video slices | **NO-GO until V0 passes** | Per readiness report §5/§6 |

## 9. Review fix — generated variants could exceed the proxy bound
**Review finding (confirmed).** The proxy refuses any origin body above 8 MiB, but nothing on the Laravel side limited the *encoded* size of a generated JPEG/WebP variant. The upload limits (5 MiB file, 8192 px edge, 40 MP) bound the **source**, not the re-encode.

### Measurements (`StorefrontMediaVariantGenerator::generate()`, GD, production-equivalent encoder defaults)
| Upload (valid under every limit) | Source size | Largest generated variant |
|---|---|---|
| 1920×8192, 1-bit noise, PNG | 3.82 MiB | **`1920w.jpg` = 10.27 MiB** (WebP 9.60 MiB) — 1.28× the proxy bound |
| 1920×8192, 1-bit noise, 64 px tile (test fixture) | 0.39 MiB | `1920w.jpg` = 10.32 MiB, WebP 9.72 MiB |
| 1920×8192, 4×4 colour blocks, JPEG q55 | 4.81 MiB | 6.00 MiB |
| 1920×8192, 2×2 16-level grey, PNG | 3.73 MiB | 7.63 MiB (0.95× — within 5 % of the bound) |
| 1200×8192 / 1920×6000 / 4000×8192 noise JPEG | 4.1–4.9 MiB | 3.9 / 4.6 / 3.7 MiB |

The mismatch needs a tall, high-entropy image (the 1920 rung of a 1920×8192 source is 15.7 MP); ordinary photos and screenshots stay far below. `renderTransform()` (per-usage derivatives) has the same ceiling-free encode and the same maximum frame (no upscaling), so it had the same exposure. Quality stepping alone cannot rescue the worst case: on the 1-bit noise JPEG q25 is still 6.05 MiB and WebP q25 7.63 MiB.

### Fix (Laravel only; no migration, no API contract change, proxy bound unchanged)
- `config/storefront_media.php` → `variant_max_bytes = 6 MiB` (below the proxy's 8 MiB, at/above the 5 MiB animated limit; deliberately not an env var so a misconfiguration cannot exceed the proxy).
- `StorefrontMediaVariantGenerator::encodeWithinCeiling()` is used by **both** `generate()` and `renderTransform()`:
  1. First attempt = the **exact call used before** ⇒ byte-identical output for every image that already fits (verified by a hash-equality test).
  2. Over the ceiling ⇒ re-encode at named `quality:` 65 → 55 → 45 (floor).
  3. Still over ⇒ `StorefrontMediaException('variant_too_large')` with a clear Arabic message. The existing failure handling stores `variants_state=failed` + `variants_error=variant_too_large` (assets) or `error_code` (derivatives) and removes any files already stored. Dimensions are never changed (file names carry the width).
- Cross-language pin: `media-proxy-guard.test.ts` reads `config/storefront_media.php` and asserts ceiling and animated limit < the proxy bound (mutation-checked: a 9 MiB ceiling fails it); the PHP test pins the Laravel side. (A first version of the PHP test read the TS file directly and failed in CI, because CI copies only selected directories into the Laravel app — fixed in the follow-up commit.)
- Nothing above the ceiling is ever handed to R2, so every newly generated file is servable by the proxy.
- `media-proxy-guard.ts`: only the explanatory comment changed (the claim “ladder files are far smaller” was false).

### Compatibility of previously generated assets
- **New uploads / retries:** capped as above. Behaviour for anything that fit is unchanged.
- **Already-generated assets:** the code cannot know whether any exist above 8 MiB. They are only possible for the extreme tall/high-entropy class in the table above; `bytes` is recorded for every file, so this is checkable read-only (no production access was used here — **owner action before deploying #1552**). The statements were reviewed and corrected in the second review round (§10) and are executed by `StorefrontMediaOversizeAuditSqlTest` on PostgreSQL:
```sql
-- A. ladder + animated files (storefront_media.variants is a json array of {file, bytes, …})
SELECT m.tenant_id, m.id AS media_id, v.item->>'file' AS file, (v.item->>'bytes')::bigint AS bytes
FROM storefront_media AS m
CROSS JOIN LATERAL json_array_elements(
    CASE WHEN json_typeof(m.variants) = 'array' THEN m.variants ELSE '[]'::json END
) AS v(item)
WHERE m.state = 'active'
  AND m.variants_state = 'ready'
  AND CASE WHEN (v.item->>'bytes') ~ '^[0-9]{1,15}$' THEN (v.item->>'bytes')::bigint END > 8388608
ORDER BY bytes DESC, m.tenant_id, m.id, file;

-- B. per-usage transform derivatives
SELECT d.tenant_id, d.media_id, d.transform_key, d.width, d.format, d.bytes
FROM storefront_media_derivatives AS d
JOIN storefront_media AS m ON m.id = d.media_id
WHERE d.state = 'ready'
  AND m.state = 'active'
  AND d.bytes > 8388608
ORDER BY d.bytes DESC, d.tenant_id, d.media_id, d.transform_key;
```
  Zero rows ⇒ no compatibility handling is needed. Rows ⇒ those specific files would answer 502 through the proxy once #1552 is deployed (only the oversized file fails; other rungs of the same asset are served — browser `srcset` fallback behaviour was not tested). Remediation, only for those rows and only with owner approval: re-upload the image smaller, or regenerate the asset through the capped path (it fails closed with `variant_too_large` rather than serving an unservable file). I did **not** raise the proxy bound to cover them (it would reopen the memory exposure P2-0 closes).

### Related finding (not changed here)
Intervention 4's `encodeUsingMediaType($type, $quality)` ignores a **positional** quality: the configured `quality.webp = 82` / `quality.jpg = 85` have never applied; encoders run at their default 75 (measured: identical bytes for q 30 and q 95 positionally, different with `quality:`). Fixing it would change the bytes, size and pixel-evidence of every new variant, so it is out of scope for a compatibility-preserving fix and needs an owner decision. The new code keeps the original call as the first attempt for exactly that reason and uses the named argument only for step-down.

### Known gaps
- The UI has no localized EN/AR key for `variant_too_large` yet; unknown codes already fall back to the server's Arabic text (`MediaPicker.tsx`). A translation key is a trivial follow-up.
- ~~If an operator lowers `STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES` below 6 MiB, large-but-valid variants will be refused; it is not enforced in code.~~ **Closed in §10.4:** the proxy now raises any smaller override to a 6 MiB floor.

## 10. Second review round — aggregate read budget (P1), audit SQL, mergeability
### 10.1 P1 finding: concurrency × body size (confirmed, fixed)
*Finding.* `STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT` (≤ 256) and `STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES` (≤ 32 MiB) were clamped **independently**, so a typo or an intentional override could permit 256 × 32 MiB = 8 GiB of buffered chunks — and `readBodyBounded` briefly holds a second, assembled copy of each body. (The earlier note “16 × 8 MiB = 128 MiB worst case” also ignored that copy.)

*Reproduced* (`docs/plans/store/s0-spikes/streaming/proxy-aggregate-budget.mjs`, results in `results/proxy-aggregate-budget.txt`; origin in a child process, all C reads held at ~the full bound, then finished together; Node 22):
| Configuration (before) | C × L | Peak RSS over baseline |
|---|---|---|
| defaults 16 × 8 MiB | 128 MiB | +224 MiB |
| C=64, L=8 MiB | 512 MiB | +669 MiB |
| C=16, L=32 MiB | 512 MiB | +640 MiB |
| C=64, L=32 MiB | 2048 MiB | **+2,204 MiB** |

*Fix* (`storefront/src/lib/commerce/media-proxy-guard.ts`, `mediaProxyLimits`): one invariant for every configuration —
`maxConcurrent × maxBodyBytes × READ_COPY_FACTOR(2) ≤ maxBufferedBytes ≤ HARD_MAX_BUFFERED_BYTES (512 MiB)`.
- Budget `STOREFRONT_MEDIA_PROXY_MAX_BUFFERED_BYTES`: default **256 MiB**, clamped to 32 MiB – 512 MiB, malformed ⇒ default. The defaults (16 × 8 MiB × 2) fill exactly the default budget, so **default behaviour is unchanged**.
- The body bound is capped at half the budget (one read always fits). Concurrency is then **lowered** until the product fits — never the body bound, because that bound is what keeps published files (≤ 6 MiB ceiling) servable (§9). Per-host cap follows the effective concurrency.
- Operators can opt in to a larger budget but never past 512 MiB; the hard ceiling is a constant, not configuration.
- When the budget lowers a requested value the proxy logs **one** server-side warning per process (requested vs. effective values only; no host, URL or secret). `maxQueue` waiters hold no bytes and are unaffected.
- Nothing else changed: gate semantics, deadlines, uniform failures, headers and tenant/publication behaviour are untouched.

*After* (same script): defaults +237 MiB; C=64 ⇒ effective C=16 (+297 MiB); L=32 MiB ⇒ C=4 (+247 MiB); C=64 & L=32 MiB ⇒ C=4 (+227 MiB); budget 512 MiB with C=256 & L=32 MiB ⇒ C=8 (+343 MiB). **Honest reading:** the budget bounds the *live buffer bytes*; measured RSS ran up to ≈ 1.2× the 256 MiB budget (allocator overhead and GC lag), i.e. ≈ 0.6–0.7 GiB at the 512 MiB hard ceiling. The default exposure is the one that already existed, now provably the maximum rather than one of many reachable values.

*Tests* (fail on the previous code, pass now; mutation-checked — removing the concurrency fit fails 8 tests): `media-proxy-guard.test.ts` “aggregate read budget” (10 tests: defaults, raised concurrency, raised body bound, opt-in/hard-capped budget, all maximum overrides together, body > half budget, a 14³-combination grid of valid/invalid values proving the invariant and `maxConcurrent ≥ 1`, invalid values ⇒ default or clamp for all three variables, gate recovery under constrained limits) and `route.test.ts` (an over-budget configuration queues, sheds, recovers, and warns once without leaking host/secret).

### 10.2 Audit SQL for already-generated variants above 8 MiB — reviewed, corrected, executed
Problems found in the first version: (1) threshold 6 MiB mixed *servable* files into the “broken” list — the proxy refuses only **> 8 MiB (8388608)**; (2) it ignored derivatives' parent state and audited deleted/failed assets that 404 anyway; (3) `json_array_elements` raises on a JSON `null`/object `variants` and the `::bigint` cast raises on a non-numeric `bytes`, aborting the whole audit; (4) filtering on `state` was missing. The corrected statements are in §9 (A: ladder + animated entries; B: derivatives); both are `SELECT`s only.

*Validation.* `StorefrontMediaOversizeAuditSqlTest` seeds: an asset with 10.27/9.2 MiB files, a file of **exactly** 8388608 (accepted ⇒ must not appear), 8388609 (must appear), a 7 MB file (above the new ceiling, still served ⇒ must not appear), deleted/failed assets, SQL-NULL / JSON-null / object / missing / non-numeric `variants`, and derivatives at/over the bound, failed, and under a deleted parent. It was run on **PostgreSQL 16** locally and runs in the pgsql CI job; a SQLite twin runs in the sqlite job.

*Expected result.* **0 rows from A and 0 rows from B ⇒ nothing to remediate.** Each row = one file that answers 502 through the proxy after #1552 deploys (columns identify tenant, media id, file/transform key and bytes). To see what the *new* ceiling would have refused, replace `8388608` with `6291456` (informational; those files still work). The audit was **not run against production** (no data access); I did not modify any data.

### 10.3 Mergeability
`mergeable_state: clean`. `git merge-tree` of the head against current `origin/main` (`1f94e1848`, #1553) is conflict-free, so no merge/rebase was performed and the base SHA is unchanged (`1296e1ce7`).

### 10.4 Third review round — P2: body override below the producer ceilings (confirmed, fixed)
*Finding.* `STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES` was clamped only to ≥ 64 KiB. A typo such as `"1"` (clamped to 64 KiB) or any value under 6 MiB made the proxy refuse variants Laravel is allowed to publish (`storefront_media.variant_max_bytes` = 6 MiB; animations ≤ 5 MiB) → 502 for valid published media. The previous round had listed this only as an unenforced operator rule (§9 “Known gaps”); the reviewer is right that a typo must not be able to do that.

*Reproduced* (tests written first, run on the previous code): 17 new/adjusted tests failed — with `"1"`, `"0"`, `"-5"`, `"1024"`, `"65536"` and `"6291455"` the proxy answered 502 for a 6 MiB JPEG/WebP variant and a 5 MiB animated GIF/WebP, and `mediaProxyLimits` returned `maxBodyBytes` = 65,536.

*Fix* (`media-proxy-guard.ts`, proxy only): new `MIN_MAX_BODY_BYTES = 6 MiB` replaces 64 KiB as the minimum of the body override.
- An integer override **below** the floor is **raised** to it (not honoured, not “fall back to default”): `"1"`, `"0"`, negatives and anything under 6 MiB become 6 MiB; the default (8 MiB) and non-numeric/non-integer values (`abc`, `1.5`, empty) still resolve to the 8 MiB default; values ≥ 6 MiB are untouched up to the existing 32 MiB cap and the budget.
- Raising is logged **once per process** (no host/URL/secret) via `limits.bodyRaisedToFloor`.
- **Aggregate budget preserved:** the floor is applied *before* the budget fit, so `maxConcurrent × maxBodyBytes × 2 ≤ maxBufferedBytes ≤ 512 MiB` still holds for every input (grid test over budget × concurrency with `"1"`); the smallest budget (32 MiB) still fits a floor-sized body with its copy (pinned). A floor-sized configuration admits 21 slots (⌊256/12⌋) at the default budget, 16 at the default concurrency. Defaults are unchanged.
- **Fail-closed unchanged:** one byte above the effective bound is still refused (uniform body-less `no-store` 502), a `Content-Length` above it is refused without draining the body, and the origin stream is cancelled. Tenant isolation, publication gating, headers and ETag/304 behaviour are untouched; the visitor host and gateway secret are still forwarded verbatim (route test).
- **Pinned to the producers:** `media-proxy-guard.test.ts` reads `config/storefront_media.php` and asserts `variant_max_bytes` = 6 MiB and the animated default = 5 MiB are both ≤ the floor (and the floor < the 8 MiB default); `StorefrontMediaVariantByteCeilingTest` asserts the same two producer limits are ≤ 6 MiB from the PHP side — so raising either producer ceiling without raising the floor fails CI in both suites.

*Tests.* New “body override floor” suite (7 tests) in `media-proxy-guard.test.ts`; route tests: six too-small overrides each serve **every** valid generated asset byte-for-byte (6 MiB JPEG, 6 MiB WebP, 5 MiB GIF, 5 MiB animated WebP), a too-small override stays fail-closed one byte above the floor and warns once without leaking host/secret, an oversize `Content-Length` is refused undrained, and host/secret forwarding is unchanged. The existing bounded-buffering route tests now use the floor (6 MiB) as their bound instead of 64 KiB, which the environment can no longer set. Evidence: `results/proxy-aggregate-budget.txt` — `"1"` ⇒ 16 × 6 MiB (+178 MiB RSS); `"1"` with 256 requested ⇒ 21 × 6 MiB (+215 MiB), both inside the 256 MiB budget.

*Residual.* `animated.max_bytes` is itself env-configurable on the Laravel side (`STOREFRONT_MEDIA_ANIMATED_MAX_BYTES`); raising it above 6 MiB would exceed the floor. Not changed here (out of scope); the pin tests above cover the **defaults** only, so an operator override of that Laravel variable is the one remaining way to exceed the proxy bound.

### 10.5 P2-0b — delivery memory safety (P1 confirmed, fixed)
*Finding (thread `PRRT_kwDOS52FT86teUxg`).* The route released the concurrency gate in `finally` as soon as it had **constructed** the `Response`. A buffered 6–8 MiB body then stays in memory until the visitor has drained it, while new requests keep acquiring the same slots — so a burst of slow downloads is not bounded by the §10.1 budget.

*Reproduced* — (1) failing regression test: with the smallest budget, four unconsumed 6 MiB responses were followed by a fifth request that returned **200** (expected 503); (2) on the **real built Next standalone server** (`proxy-delivery-memory.mjs`, fake Laravel origin, raw-socket visitors reading 16 KiB/s, baseline 146 MiB):

| Visitors × hosts (6 MiB bodies) | Accepted | Shed (503) | Peak RSS |
|---|---|---|---|
| 16 × 1 | 16 | 0 | 296 MiB |
| 48 × 1 | 48 | 0 | 492 MiB |
| 96 × 1 | 59 (37 had no response yet) | 0 | **803 MiB** |
| 48 × 8 | 48 | 0 | 500 MiB |
| 96 × 8 | 96 | 0 | **795 MiB** |

*Lifecycle traced* (route → Next → socket): the origin round-trip ends at `readBodyBounded`; `new Response(body)` returns and the handler's `finally` ran (the bug); Next then consumes the body lazily — on the real server a visitor reading 16 KiB/s keeps its response outstanding for the whole hold (no `slowCompleted`), so delivery is paced by the visitor. A visitor that **disconnects** ends the delivery: after all slow visitors dropped, the share was available again within 3 s, far below the 120 s deadline (whether Next does this by cancelling the body, by aborting `request.signal`, or both was not isolated — the release handles either). A visitor that **stays connected but never reads** produces neither event: with the default 120 s deadline its share is still held at 14 s, with a 10 s deadline it is cut off. A failure before the Response exists never reaches delivery. Every exit now ends in the same single, idempotent release.

*Mechanism (smallest safe).* One resource model for both phases, in the existing gate:
- `acquire(host, signal, bytes)` takes a **slot and `maxBodyBytes × 2` bytes** of the budget atomically (same FIFO queue, same 4 s wait, same `503` + `Retry-After: 2`, same per-host fairness — now also a **per-host byte share** of half the budget).
- After the origin read, `permit.endRound(max(bodyBytes, 64 KiB))` frees the **slot at once** (Laravel's workers and the 16 slots are never held by a slow visitor) and **shrinks** the reservation to the buffered body's own size.
- The body is delivered by `deliverBuffered()`: a **pull-based** stream (`highWaterMark: 0`, 64 KiB views of the one buffer, no copies, nothing handed over ahead of the consumer). It is **not** origin streaming — Laravel's bytes are fully read first and never reach the visitor while the origin socket is open.
- The permit is released **exactly once** (idempotent) when: the consumer asks for more after the last chunk (all chunks consumed), the consumer **cancels** (disconnect), `request.signal` **aborts**, or the **delivery deadline** (120 s, 10–600 s via `STOREFRONT_MEDIA_PROXY_DELIVERY_TIMEOUT_MS`) passes — the last two also error the stream so a stalled connection is torn down rather than left half-open. A response that never gets a consumer is therefore still bounded in time. 304/404/502/oversize paths release in `finally`.
- Each outstanding delivery is charged at least 64 KiB, so tiny images cannot be held open in unbounded numbers (≤ 4,096 outstanding at the default budget).

*What did not change* (A/B on the real built server, `status`/headers/bytes/sha256 identical for 200, conditional 304 and 404): `Cache-Control`, ETag/304, `X-Content-Type-Options`, content-type, chunked framing (no `Content-Length` before or after), tenant/storefront resolution (host + gateway secret still forwarded verbatim), publication gating, the 6 MiB producer floor, the 8 MiB default, all AR/EN-facing behaviour (no user-visible strings in this path). No migration, API contract, Laravel or accounting change.

*After* (same harness, same machine, built from this branch):
| Visitors × hosts | Accepted | Shed (503) | Peak RSS (VmHWM) | Probe from an unrelated host while they download |
|---|---|---|---|---|
| 16 × 1 | 16 | 0 | 286 MiB | 200 in 90 ms |
| 48 × 1 | 19 | 29 | 305 MiB | 200 in 102 ms |
| 96 × 1 | 19 | 77 | **300 MiB** (was 803) | 200 in 151 ms |
| 48 × 8 | 41 | 7 | 453 MiB | 503 after 4.0 s, `Retry-After: 2` (global budget full) |
| 96 × 8 | 41 | 55 | **419 MiB** (was 795) | 503 after 4.0 s, `Retry-After: 2` |

- *Fairness:* one storefront's slow visitors are capped at its half-share (≈ 19 × 6 MiB); an unrelated storefront is still served (200).
- *Overload:* when the whole budget is outstanding, new requests wait ≤ 4 s then get `503` + `Retry-After: 2`, never an unbounded queue.
- *Recovery after disconnect:* after every slow visitor dropped, 6 of 6 follow-up requests returned 200 with the full body; RSS fell back to 175–204 MiB. Stalled visitors that never read: with the default 120 s deadline they keep their share (probe → 503); with `…DELIVERY_TIMEOUT_MS=10000` they are cut off and the probe returns 200 in 45 ms.
- *Throughput (6 MiB, loopback):* sequential median 33 ms → 20 ms, 16 parallel 1,159 ms → 608 ms (noise-level; no regression).

*Measured upper bound.* The budget bounds **live buffer bytes** (reads reserve 2 × body bound; deliveries keep their own size): ≤ 256 MiB at the defaults (≤ 512 MiB hard ceiling). Peak RSS in the eight-host runs was **baseline 146 MiB + 273–307 MiB**, i.e. ≈ **1.07–1.2 × the budget** above baseline (allocator/GC overhead, plus ≤ 64 KiB per connection still in Node's write buffer after the share is released). Kernel socket buffers are outside RSS. Plan for **baseline + 1.2 × maxBufferedBytes** (≈ 450 MiB at the defaults), not baseline + budget.

*Tests* (fail first, then pass): route — the REGRESSION above, delivery completes → share returned exactly once, cancel (twice, and after completion) , request-abort, bytes/headers unchanged, 304/404/502/oversize hold nothing, per-host fairness, mass-disconnect recovery; guard — byte-aware gate (reserve/endRound/idempotent release, queue on bytes, deadline shed, abort-while-queued, per-host share, no-budget compatibility), `deliverBuffered` (exact bytes and order, pull-based, empty body, cancel, abort, already-aborted, **deadline with fake timers**, timer cleared on completion, throwing `onSettled`), and the new limits (delivery timeout default/clamp, per-host share).

*Remaining limitations / unverified.* (1) Budget is per instance (one replica today). (2) A coordinated slow-client attack can exhaust the budget so legitimate visitors see `503` until the 120 s deadline cuts the attackers off — an availability trade-off chosen over OOM; an attacker rotating `Host` defeats only the fairness share, not the global budget. (3) Visitors slower than ≈ size/120 s (≈ 50 KiB/s for a 6 MiB file) are cut off mid-body — a truncated chunked response, which browsers report as a failed load; **not verified on real devices or behind the Railway edge/CDN**. (4) Behaviour of intermediaries on early cancel, HTTP/2, and Range/HEAD (unsupported on this route) are untested. (5) The harness drives raw TCP clients on loopback, not real browsers or mobile networks.

### 10.6 Out of scope (unchanged)
Image quality defaults (the positional-quality finding in §9 stays reported-only), AVIF/video, migrations, API contracts, accounting/ERP logic.

## 11. Identifiers
Branch `claude/awj-p2-0-media-proxy-hardening` · PR [#1552](https://github.com/safwan5001-source/Nebrax/pull/1552) · Base `1296e1ce79a339f94336f92c3258ec5fb0d815e6`

| Head | Content | CI |
|---|---|---|
| `d38d7ea9a86bffd6aa4a84fc1e870b6244b18cd6` | P2-0 proxy hardening | all green (storefront, both visual QAs, php sqlite 11m49s, php pgsql 17m27s) |
| `abd9a3eefb45f78521455cb8656cd9fa3132a563` | review fix: variant ceiling | php sqlite/pgsql **failed**: my own pin test read `storefront/…/media-proxy-guard.ts`, which CI does not copy into the Laravel app (the generator tests themselves passed: 7,485 passed, 1 failed) |
| `84d600a118224cf3a0d0493e4a6c6fffda9960bf` | pin moved to the storefront test | **all green**: storefront ✅, merchant preview QA ✅, published footer QA ✅, php sqlite ✅ (17m), php pgsql ✅ (12m), CI Gate ✅ |
| `17b253f40756430628b18a41989017e3d55cde2a` | round 2: read-memory budget (P1), audit-SQL test, spike | storefront ✅, merchant preview QA ✅, published footer QA ✅, php sqlite ✅ (16m), php pgsql ✅ (18m, includes the audit SQL on PostgreSQL); CI Gate (aggregator) was still finishing at the last check |
| `c85ee1f8b0e1647266b43d5fea9cbf60b5531820` | round 3: body-override floor (P2) | **all green**: storefront ✅ (×2), merchant preview QA ✅, published footer QA ✅, php sqlite ✅ (14m), php pgsql ✅ (12m), CI Gate ✅ |
| `e94c6951f3bcaa0db20e01f07220f4136768ee2c` | round 3 docs (CI results) | docs only |
| `d191e9b2496c162372ff893b312e53fe6f201dab` | P2-0b: delivery memory safety (P1) | **all green**: storefront ✅ (×2), merchant preview QA ✅, published footer QA ✅, php sqlite ✅ (18m), php pgsql ✅ (17m), CI Gate ✅ |
| final head | this docs-only commit (see PR head) | docs only; reruns the same workflows |

No merge, deployment, migration, API change, R2 or infrastructure change was made.
