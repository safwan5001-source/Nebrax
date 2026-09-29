# AWJ App Builder — Benchmark Matrix

**Purpose:** durable evidence matrix for App Builder UX, components, features, preview, and runtime behavior.

This file is a **benchmark**, not AWJ's product contract. Every AWJ implementation decision must still respect the approved Horizon, security boundaries, Tenant Isolation, backward compatibility, and runtime contracts.

| Area | Salla | Zid | Shopify | Other useful reference | AWJ decision | Horizon / status |
|---|---|---|---|---|---|---|
| Design vs Preview | Separate design/customization and app preview patterns | Managed mobile-app service; not equivalent self-serve builder model | Editor with live preview and full-width/collapsed-sidebar patterns | Add only when official evidence is useful | Keep explicit Design vs App Preview modes | MP-3 delivered |
| Mobile admin preview | Full/content-first preview is more useful than nested tiny device | Evidence differs by service model | Responsive editor patterns | — | No phone-inside-phone on small admin screens | MP-3 delivered |
| Device frame | Used as orientation/context | — | Viewport modes rather than native-proof framing | — | Frame is presentation only; never native/runtime proof | MP-3 delivered |
| App-level navigation | Preview should cover meaningful app destinations/states | Compare only where documented | Flutter's Router: page-backed routes are declarative/deep-linkable; pageless routes (dialogs) are not, and vanish with their parent page — a real supported/unsupported split, not a style choice | Browser Preview now dispatches `navigate`/`openProduct`/cart actions for real, but only ever claims the exact pageIds the shipped `RuntimeActionHandler.onNavigate` actually wires (`home`/`cart`) as "navigate"; any other pageId — even one the merchant genuinely authored as a schema page — is flagged as a truthful "not supported by the real app today" limitation, never a generic page router the app doesn't have | MP-4 delivered |
| Empty/auth states | Empty cart/orders/account/category states visible in preview | Compare when documented | Shopify theme app extensions: a block that cannot be previewed shows "No preview available" rather than faking a render; a cart-based extension previewed in the theme editor always renders against an empty cart (a real, permanent limitation the platform discloses, not a bug to hide) | Actions needing live commerce/auth (`openProduct`, `addToCart`, `updateCartQuantity`, `removeCartItem`) show an explicit "unavailable in Browser Preview — requires live data" notice on tap, matching Shopify's own disclose-don't-fake pattern; static sample data still can't demonstrate a genuinely *empty* cart/list state — tracked as a known MP-4 limitation, not solved here | MP-4 delivered (partial — see limitation) |
| Component/action registry parity | — | — | — | — | Shared `contracts/app-builder/registry-identifiers.v1.json` + `action-navigation-conformance.v1.json` fixtures now regression-guard identifier-set equality across web/mobile (extends the LIVE-PREVIEW-2 binding/visibility fixture pattern) | MP-4 delivered |
| Sections/components | Rich section library and app customization options | Compare documented components/features | Theme sections/blocks/editor patterns | Wix/Squarespace/FlutterFlow if relevant | Use reusable declarative components; do not copy blindly | Ongoing |
| Simple vs advanced settings | Merchant-facing sections/settings | Compare documented service controls | Progressive editor controls | — | Keep common controls simple; advanced options separated | Ongoing |
| Refresh preview | Explicit refresh can exist depending on architecture | — | Live-auto-updating editor patterns | — | No no-op refresh; only add if architecture genuinely needs refresh | MP-3/MP-5 |
| Runtime truth | Browser preview is not native runtime | — | Web storefront preview is not mobile-native proof | Flutter official docs | Truth levels remain explicit: Canvas → Browser Preview → Flutter Runtime → Physical Device | Horizon locked |
| Flutter Web | — | — | — | Flutter official embedding/runtime docs | Deferred; Hybrid architecture remains authoritative | MP-2 locked |
| Auth/live data | Do not infer credential model from competitor UX | Do not infer | Do not infer | OWASP Session Mgmt/REST/API-Security cheat sheets; RFC 6750 (bearer tokens); RFC 8628 (device authorization grant); Apple Universal Links/Android App Links/Flutter deep-linking docs | New `PreviewSession` Sanctum principal (opaque token, single `preview:read` ability, ≤60min TTL) — the fifth application of AWJ's own existing scoped-token pattern (`ApiClient`/`CustomerIdentity`/`PlatformAdministrator`), kept off `commerce/v1` so preview never needs a store bearer; QR/deep-link carries a one-time exchange reference only, never the bearer, extending the mobile runtime's own already-shipped "no tokens in deep-link query strings" rule | MP-5 delivered — `MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md`, Decision Gate: PASS, implementation deferred to MP-6+ |

## Update rules
- Prefer official/current sources.
- Record only durable patterns relevant to AWJ.
- Distinguish observed evidence from AWJ decisions.
- Do not treat absence of documentation as proof a feature does not exist.
- Do not convert benchmark findings into schema/auth/API changes without the appropriate Decision Gate.
- Keep this matrix concise; detailed task evidence belongs in task reports.
