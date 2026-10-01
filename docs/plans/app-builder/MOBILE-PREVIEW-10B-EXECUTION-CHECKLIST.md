# MOBILE-PREVIEW-10B — Real Device Execution Checklist (Operator Reference)

**Status: NOT EXECUTED.** This is a checklist for the later, separately authorized execution
phase. Nothing in this file has been run, provisioned, or verified. It exists so whoever runs
the real-device pass has a single ordered list instead of re-deriving one from
`MOBILE-PREVIEW-10A-REAL-DEVICE-READINESS.md`. Read that document for the evidence and reasoning
behind each item below.

Check off each box only after the action has genuinely been performed and its evidence captured
— this file must never be edited to claim completion that did not happen.

---

## Phase 0 — Owner approvals (must all be ✅ before anything else)

- [ ] Hosting/DNS/TLS provisioning for `preview.awjdev.xyz` explicitly authorized
- [ ] Source edit authorized: update the three hardcoded placeholder-host occurrences
      (`mobile/android/.../AndroidManifest.xml`, `mobile/ios/Runner/Runner.entitlements`,
      `mobile/lib/preview/preview_deep_link.dart`) from `preview.awj-runtime-proof.example` to
      `preview.awjdev.xyz`, as its own small reviewable PR
- [ ] `PREVIEW_DEEP_LINK_HOST` environment variable set to `preview.awjdev.xyz` wherever the
      backend serving `preview/v1` runs for this test
- [ ] Apple Developer Team ID / account identified and available for signing
- [ ] Decision recorded: debug-signed Android test build acceptable for this pass, or a real
      release key is being introduced now

## Phase 1 — Hosting (infrastructure team / owner-authorized operator)

- [ ] `preview.awjdev.xyz` resolves and serves HTTPS
- [ ] `https://preview.awjdev.xyz/.well-known/assetlinks.json` live, correct `package_name`,
      correct `sha256_cert_fingerprints` for the exact keystore used in Phase 3
- [ ] `https://preview.awjdev.xyz/.well-known/apple-app-site-association` live, correct
      `appIDs` (`<TEAMID>.com.example.awjMobileRuntimeProof`), `components` scoped to
      `/preview/*`, `apps: []`, no redirect, `application/json`, no extension
- [ ] `https://preview.awjdev.xyz/preview/{reference}` fallback route live, matching the
      contract in MOBILE-PREVIEW-10A §10 (generic messaging, no echo, no redirect)
- [ ] `Referrer-Policy: no-referrer` set on the fallback route
- [ ] No analytics/telemetry attached to the fallback route or either association file
- [ ] Reverse-proxy/CDN access logs configured to redact or hash the `{reference}` path segment

## Phase 2 — Source edit (its own PR, not this one)

- [ ] Three placeholder-host occurrences updated to `preview.awjdev.xyz` (see Phase 0)
- [ ] `php artisan test` green (unaffected by this edit, but run per repo policy)
- [ ] `mobile-ci.yml` green for the Dart-side change
- [ ] Merged before Phase 3 begins

## Phase 3 — Android physical device

- [ ] Android Gradle wrapper/platform scaffold confirmed valid (restored/regenerated from the
      repo's pinned Flutter version if missing or stale, without overwriting AWJ native
      customizations), then `flutter pub get` run in `mobile/` for Dart/Flutter dependencies
- [ ] Real device connected, listed by `flutter devices`
- [ ] `flutter run --target lib/main_device_preview.dart --dart-define=PREVIEW_BASE_URL=<real-backend-url>/preview/v1 -d <device-id>`
- [ ] QR issued from the dashboard for a real draft
- [ ] QR scanned on-device; OS offers/opens the AWJ app directly (true App Link — not browser)
- [ ] Real runtime renders the actual draft experience
- [ ] Second use of the same reference → rejected, confirmed no second session created
- [ ] Expired reference (wait 5+ minutes) → rejected
- [ ] Session revoked via dashboard → subsequent `/experience` fetch fails
- [ ] Evidence captured: screen recording, device model/OS version, redacted `logcat` excerpt,
      exact run command, backend row states before/after

## Phase 4 — iOS physical device

- [ ] `DEVELOPMENT_TEAM` set in Xcode for a real Apple Developer account
- [ ] Real iPhone connected
- [ ] `main_device_preview.dart` built and run on-device (Xcode or `flutter run`)
- [ ] QR issued from the dashboard for a real draft
- [ ] Link opened on-device (Camera or Notes app per Apple/Flutter guidance); AWJ app opens
      directly (true Universal Link — not Safari)
- [ ] Real runtime renders the actual draft experience
- [ ] Second use of the same reference → rejected
- [ ] Expired reference → rejected
- [ ] Session revoked via dashboard → subsequent `/experience` fetch fails
- [ ] Evidence captured: screen recording, device model/iOS version, exact run command, backend
      row states before/after

## Phase 5 — Closure

- [ ] Evidence from Phases 3 and 4 attached to the Horizon closure record
- [ ] `AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md` Criterion #10 updated from `OPEN` to
      `PASS`, citing the evidence above
- [ ] Horizon closure status reassessed (only after Criterion #10 is genuinely `PASS`)

---

**Reminder:** source inspection, widget/unit tests, CI, emulator runs, and release-build-only
proofs do **not** satisfy Phases 3 or 4. Only genuine execution on physical hardware, with
captured evidence, does.
