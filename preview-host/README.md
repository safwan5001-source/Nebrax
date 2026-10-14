# preview-host

Isolated, dependency-free service for the AWJ mobile preview link host
(`preview.awjdev.xyz`, not yet provisioned). It serves only:

| Route | Purpose |
|---|---|
| `GET /.well-known/assetlinks.json` | Android App Links association |
| `GET /.well-known/apple-app-site-association` | Apple Universal Links association |
| `GET /preview/{reference}` | Static, generic browser fallback |
| `GET /health` | Health check (`{"status":"ok"}`) |

```bash
npm test                      # node:test, no install step needed
ANDROID_APP_LINK_SHA256_FINGERPRINTS=<sha256[,sha256...]> APPLE_TEAM_ID=<team id> npm start
```

Full design, security headers, logging behaviour and deployment requirements:
`docs/plans/app-builder/MOBILE-PREVIEW-10B-2A-PREVIEW-HOST-IMPLEMENTATION-REPORT.md`.
