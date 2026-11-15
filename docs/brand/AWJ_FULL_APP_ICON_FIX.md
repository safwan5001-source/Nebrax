# AWJ full browser and installed-app icon

Base: `b81367eeb2f085547ae0cf2c74a3e053a109c5e8`.

Owner decision: use the complete white Arabic AWJ wordmark on blue for both browser and installed-app icons, replacing the alif monogram.

Changes:
- Replace App Router icon.ico with the full wordmark at 16/32/48/64/128/256.
- Add an opaque 180x180 PNG at `/brand/awj/app-icon-v2.png`.
- Both server-resolved identity and authenticated client identity use that PNG when a valid company logo is absent. Root icon/Apple metadata still resolves company identity through the existing endpoint; company URL validation, host/origin resolution, session cleanup and tenant switching stay intact.
- Keep the Fuel Stations PWA unchanged.
- Update existing fallback assertions and validate PNG signature and dimensions in the favicon test.

Validation: locally verified ICO resolutions, 180x180 PNG dimensions/opaque background and visual full-wordmark rendering. Full Vitest/Next.js build require Web CI; this environment has no installed Vitest. No local test/build success is claimed.

No merge or deployment. After deployment, an already-added iOS shortcut may retain its saved icon; remove and re-add the home-screen shortcut to verify the new asset on the device. This does not remove server data.
