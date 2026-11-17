# Plan: first iteration (v0.1)

Goal: an admin can create a campaign, add categories and candidates, open voting, show the
QR code, watch live counts, and close voting. Voters scan the QR code, vote once per category
from their device, and see the results after voting closes. Everything runs locally with
`bun run dev`.

Status: `[x]` done · `[ ]` pending

## Phase 1: Backend foundations
- [x] `lib/crypto.ts`: HMAC sign/verify (Web Crypto), constant-time compare, random slug
- [x] `lib/validate.ts`: names, UUIDs, slugs, status transitions, vote payload parsing
- [x] `lib/http.ts`: JSON body reader (rejects non-JSON), error helper
- [x] `lib/auth.ts`: credential check, signed 12h session cookie, `requireAdmin`
- [x] `lib/device.ts`: signed 1-year `vc_device` cookie middleware
- [x] `lib/qr.ts`: QR SVG via `uqr`
- [x] `src/shared/types.ts`: API types shared by the worker and the client

## Phase 2: Data and API
- [x] `lib/db.ts`: every query, bound parameters only
- [x] `lib/ballot.ts`: build category trees, ballot view, results (winners and ties), vote checks
- [x] Admin API: login/logout, campaign CRUD, status transitions, categories, candidates, QR
- [x] Public API: campaign state by slug; cast votes (409 on duplicate, 400 on invalid)
- [x] Security: `secureHeaders` (CSP), `csrf()`, JSON-only writes, `no-store` on the API, `_headers` for static pages

## Phase 3: Front end and styles
- [x] `styles.css`: design tokens, light/dark, buttons, cards, forms, badges, ballot choices, result bars, QR presenter
- [x] `dom.ts` / `api.ts`: safe element builder (no `innerHTML`), fetch wrapper
- [x] Login page
- [x] Back office: campaign list and create; detail with open/close/reopen/delete, quick-add default
      categories, candidates, live counts (3 s polling), QR with copy link, download, and present mode
- [x] Voter page: not open yet (auto-refresh), ballot, already-voted and thank-you state, results with winners

## Phase 4: Testing
- [x] Unit tests (`bun test`): crypto, validation, ballot/results logic
- [x] End-to-end smoke test (`bun run smoke`) against `wrangler dev`: login, build a campaign,
      vote from two devices, reject duplicates and bad input, close, check results
- [ ] Manual check in a browser (desktop and phone on the same Wi-Fi)

## Phase 5: Release (after v0.1 is verified locally)
- [ ] `wrangler d1 create`, set the real `database_id`, `db:migrate:remote`
- [ ] `wrangler secret put` ADMIN_EMAIL / ADMIN_PASSWORD / SESSION_SECRET
- [ ] `bun run deploy`; optional custom domain and Workers Builds with `BUN_VERSION`

## Rules decided for v0.1
- Lifecycle `draft → open → closed`, plus `closed → open` (reopen) for mistakes.
- Categories and candidates can be **added** while draft or open, and **deleted** only while
  draft (so votes are never silently removed). Nothing can be edited once closed.
- Opening requires at least one category, and every category needs at least one candidate.
- A ballot may be partial; a device can come back later for the categories it skipped.
- One vote per device per category, using the signed cookie (no IP tracking).

## Known limits / later
- Login has no rate limiting yet (consider Cloudflare rate-limiting rules).
- Private windows or other browsers on the same device can vote again (accepted for v0.1).
