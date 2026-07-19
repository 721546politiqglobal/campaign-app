# Baseline build & test health — 2026-07-15

## Typecheck — PASS
`npm run typecheck` → exit 0, no errors.

## Test suite — PASS
`npm test` → 13 test files, 96 tests, all passing (447ms).

## Production build — FAIL (environment, not code)
`npm run build` fails at the `next/font` step: it fetches the `Manrope` font
from `fonts.googleapis.com` at build time, and this machine cannot resolve
that host (`getaddrinfo ENOTFOUND fonts.googleapis.com`). Persists with the
sandbox disabled, so it is a network-reachability issue on this box, not a
code defect. It WILL surface as a real finding regardless:

### TEST-BUILD-1 — Build depends on network access to Google Fonts CDN
- **Severity:** P2
- **Dimension:** tests
- **Location:** src/app/layout.tsx (next/font/google Manrope import)
- **What's wrong:** `next/font/google` fetches the font at build time. Any
  build environment without egress to fonts.googleapis.com (air-gapped CI,
  restricted network, offline) fails the entire build.
- **How it fails:** CI runner or local build with no Google Fonts egress →
  `FetchError ENOTFOUND` → build fails, deploy blocked. Could not verify the
  build otherwise succeeds because of this.
- **Proposed fix:** Self-host the font (next/font/local with the woff2 files
  committed), or confirm the deploy environment always has Google Fonts
  egress. Self-hosting also improves runtime performance and privacy.
- **Effort:** S
