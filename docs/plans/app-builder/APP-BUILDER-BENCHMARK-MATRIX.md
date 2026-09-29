# AWJ App Builder — Benchmark Matrix

**Purpose:** durable evidence matrix for App Builder UX, components, features, preview, and runtime behavior.

This file is a **benchmark**, not AWJ's product contract. Every AWJ implementation decision must still respect the approved Horizon, security boundaries, Tenant Isolation, backward compatibility, and runtime contracts.

| Area | Salla | Zid | Shopify | Other useful reference | AWJ decision | Horizon / status |
|---|---|---|---|---|---|---|
| Design vs Preview | Separate design/customization and app preview patterns | Managed mobile-app service; not equivalent self-serve builder model | Editor with live preview and full-width/collapsed-sidebar patterns | Add only when official evidence is useful | Keep explicit Design vs App Preview modes | MP-3 delivered |
| Mobile admin preview | Full/content-first preview is more useful than nested tiny device | Evidence differs by service model | Responsive editor patterns | — | No phone-inside-phone on small admin screens | MP-3 delivered |
| Device frame | Used as orientation/context | — | Viewport modes rather than native-proof framing | — | Frame is presentation only; never native/runtime proof | MP-3 delivered |
| App-level navigation | Preview should cover meaningful app destinations/states | Compare only where documented | Preview/editor navigation patterns | — | Align supported declarative navigation with runtime; no invented routes | MP-4 |
| Empty/auth states | Empty cart/orders/account/category states visible in preview | Compare when documented | Mature empty/error state patterns | — | First-class truthful preview states | MP-4 |
| Sections/components | Rich section library and app customization options | Compare documented components/features | Theme sections/blocks/editor patterns | Wix/Squarespace/FlutterFlow if relevant | Use reusable declarative components; do not copy blindly | Ongoing |
| Simple vs advanced settings | Merchant-facing sections/settings | Compare documented service controls | Progressive editor controls | — | Keep common controls simple; advanced options separated | Ongoing |
| Refresh preview | Explicit refresh can exist depending on architecture | — | Live-auto-updating editor patterns | — | No no-op refresh; only add if architecture genuinely needs refresh | MP-3/MP-5 |
| Runtime truth | Browser preview is not native runtime | — | Web storefront preview is not mobile-native proof | Flutter official docs | Truth levels remain explicit: Canvas → Browser Preview → Flutter Runtime → Physical Device | Horizon locked |
| Flutter Web | — | — | — | Flutter official embedding/runtime docs | Deferred; Hybrid architecture remains authoritative | MP-2 locked |
| Auth/live data | Do not infer credential model from competitor UX | Do not infer | Do not infer | Security-specific evidence separately | No admin/store-token leakage; MP-5 Decision Gate required | MP-5 |

## Update rules
- Prefer official/current sources.
- Record only durable patterns relevant to AWJ.
- Distinguish observed evidence from AWJ decisions.
- Do not treat absence of documentation as proof a feature does not exist.
- Do not convert benchmark findings into schema/auth/API changes without the appropriate Decision Gate.
- Keep this matrix concise; detailed task evidence belongs in task reports.
