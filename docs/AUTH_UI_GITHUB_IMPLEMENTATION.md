# Nebrax Authentication UI — Repository Implementation Notes

The real authentication implementation lives in `web/src/app/login/page.tsx` and `web/src/app/register/page.tsx`. Both pages already preserve real API calls through `web/src/lib/auth.ts`, use React Hook Form with Zod, and source user-facing copy from `web/src/messages/ar.json` and `web/src/messages/en.json`.

The approved design-system source of truth is `DESIGN_SYSTEM.md`, with semantic tokens already declared in `web/src/app/globals.css` and mapped through `web/tailwind.config.ts`. The refinement will preserve those tokens, use the shared `Input`, `Button`, `NebraxLogo`, `ThemeToggle`, and `LangToggle` components, maintain RTL/LTR behavior, and avoid changing the authentication API contract.

The planned visible changes are limited to auth-screen geometry, semantic labels and field feedback, password-control spacing, a clear Saudi country-code area, account-focused auth terminology, and compact responsive spacing.

## Live Preview Check

The GitHub working copy was run locally through Next.js and inspected at `/login` and `/register`. Both routes render the account-focused Arabic copy, semantic labels, show/hide password controls, the `.nebrax.app` suffix, and a visible Saudi flag with the `السعودية +966` country-code area. The real login and registration API calls remain in their original modules and route targets.

Submitting the empty registration form displayed field-local error messages without issuing a registration request. The password visibility control also switched the input type and accessible label between show and hide states as expected.
