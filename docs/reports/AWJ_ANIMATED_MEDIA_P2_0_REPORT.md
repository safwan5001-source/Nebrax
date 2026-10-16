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
| Max buffered body | **8 MiB** (floor 64 KiB, ceiling 32 MiB) | `STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES` | Largest legitimate body is the sanitised animation ≤ 5 MiB (`storefront_media.animated.max_bytes`); ladder files are far smaller. |
| Concurrent origin round-trips | **16** (1–256); one host ≤ half | `STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT` | Bounds Laravel workers used by this proxy per instance and peak read memory (16 × 8 MiB = 128 MiB worst case). |
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
5. **Not fixed (honest limitation) — delivery-phase memory.** The gate covers the *origin round-trip*, not the time a finished buffer waits for a slow visitor to drain it. 100 slow visitors on 5 MB bodies still hold ≈ 500–600 MiB, as before (543 vs 600 MiB above). Bounding that needs an in-flight-bytes budget released on response completion, which means wrapping the buffer in a stream and re-checking Next's framing/`Content-Length` — a behaviour change the P2-0 brief excludes. Worst case is now at least capped per body (8 MiB), but not in aggregate. **Recommended follow-up (P2-0b, optional):** in-flight byte budget + `Content-Length` on the wrapped response, with a slow-loris test, before enabling any large asset on this path. Until then, watch the storefront service memory in Railway.
6. **Limits are per Node instance** (the storefront runs 1 replica); with more replicas the effective global limit multiplies.
7. **The per-host cap is fairness, not a security boundary**: the key is the visitor-supplied `Host`, so an attacker rotating Host values avoids the per-host cap but is still held by the global cap and queue.
8. **Defaults are reasoned, not tuned on production traffic.** Under a real traffic spike a legitimate visitor can now see `503` where before the request would have queued inside Laravel; the browser shows a broken image until reload. If monitoring shows shedding at normal load, raise `…MAX_CONCURRENT` (an env change, owner decision).
9. **Tenant isolation / publication gating unchanged**: tenant and storefront are still resolved only by the origin from the forwarded host; the Published-reference gate still runs on every call; the gate key is only a counter label, nothing is cached or shared between hosts.

## 7. Risks and remaining work
| Risk | Level | Note |
|---|---|---|
| Delivery-phase memory not aggregated-bounded (finding 5) | Medium | Same as today; follow-up P2-0b |
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
| **P2-0b** delivery-phase memory budget | Optional, **GO if** you want aggregate bounds before bigger files | Brief that allows changing the response framing |
| V1–V7 video slices | **NO-GO until V0 passes** | Per readiness report §5/§6 |

## 9. Identifiers
Branch `claude/awj-p2-0-media-proxy-hardening` · PR [#1552](https://github.com/safwan5001-source/Nebrax/pull/1552) · Base `1296e1ce79a339f94336f92c3258ec5fb0d815e6` · Code head `d38d7ea9a86bffd6aa4a84fc1e870b6244b18cd6` · Final head this docs-only commit (see PR head) · CI: on code head `d38d7ea9a`: storefront lint+typecheck+test ✅, merchant preview visual QA ✅, published footer visual QA ✅, php sqlite ✅ (11m49s), php pgsql ✅ (17m27s); CI Gate was still finishing at the last check (it only aggregates the jobs above)

No merge, deployment, migration, API change, R2 or infrastructure change was made.
