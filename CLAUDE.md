# CLAUDE.md

Guidance for AI agents (and humans) working in this repository.

## Main goal

A simple web application used to vote during Toastmasters sessions.

- **Back office** (admin only): create sessions/campaigns, add categories (Best Speaker,
  Best Table Topics, Best Evaluator, …), add candidates to each category, watch the vote
  counts as they come in, open/close the campaign, and get the campaign's QR code.
- **Front page** (voters): reached by scanning the QR code. Shows the ballot while the
  campaign is open, and shows the results once it is closed. The QR link never changes.

## Non-negotiable rules

1. **Read [MAP.md](MAP.md) before working.** It describes every file in the repo.
   **Any change that adds, removes, renames, or changes the purpose of a file must update
   MAP.md in the same change.** A file missing from MAP.md is a bug.
2. **Keep it simple.** No frontend framework, no ORM, no extra services. Prefer fewer files
   and fewer dependencies. Ask before adding a runtime dependency.
3. **Cloudflare-first.** Everything (static front end + API + database) runs on Cloudflare:
   one Worker with Static Assets, and D1 for storage. Code in `src/worker/` must run on the
   Workers runtime (Web APIs only, no Node or Bun APIs).
4. **Bun + TypeScript for tooling.** Use `bun` for installing, building, testing, and running
   scripts (`bunx wrangler …`). Don't use npm/yarn/pnpm. The Bun version is pinned in
   `.env.example` (`BUN_VERSION`) and `package.json` (`packageManager`); keep them in sync.
5. **Secrets never go in git.** `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` live in
   `.env` locally (git-ignored) and in Wrangler secrets in production. Never hard-code them,
   log them, or echo them in responses.
6. **Schema changes are new migrations.** Never edit an applied file in `migrations/`; add
   the next numbered one.

## Security rules (always)

- **SQL:** bound parameters (`?` + `.bind()`) only, and SQL only in `src/worker/lib/db.ts`.
- **XSS:** browser code builds DOM with `h()` from `src/client/dom.ts` (text nodes). Never use
  `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` with any data.
- **No inline scripts or styles** in HTML (the CSP forbids them). Put CSS in `public/styles.css`;
  dynamic sizes go through `el.style.x = …` (CSSOM, allowed).
- **Writes are JSON-only** (`readJson`), behind `csrf()`. Never add CORS headers; the front end is same-origin.
- **Validate every input** with `src/worker/lib/validate.ts` before it reaches the database.
- **Cookies** are HttpOnly and signed (`signValue`/`verifyValue`); never trust an unsigned id.

## Architecture (summary; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md))

- **Runtime:** a single Cloudflare Worker (`src/worker/index.ts`, Hono router) serves
  `/api/*` and `/v/:slug`; everything else is static files from `public/`.
- **Storage:** Cloudflare D1 (SQLite). Tables: `campaigns`, `categories`, `candidates`, `votes`.
- **Front end:** plain HTML + CSS in `public/`, with small TypeScript scripts in
  `src/client/` bundled by `bun build` into `public/assets/`.
- **Admin auth:** a single admin. Email + password are checked against Wrangler secrets;
  success sets a signed, HttpOnly session cookie.
- **One vote per device:** browsers cannot read a MAC address, so each device gets a signed,
  long-lived, HttpOnly device-ID cookie. The database enforces one vote per device per category
  (`UNIQUE(category_id, device_id)`).
- **Campaign lifecycle:** `draft` → `open` → `closed` (and `closed` → `open` to reopen). The QR
  code points to `/v/<slug>`: draft shows "not open yet", open shows the ballot, closed shows the
  results. Categories and candidates can be added while draft or open, and deleted only in draft.
- **Plan and status:** [docs/PLAN.md](docs/PLAN.md).

## Commands

```sh
bun run setup               # first time: create .env from the example, install, migrate local D1
bun install                 # install dependencies
bun run build               # bundle src/client/*.ts -> public/assets/
bun run dev                 # build, then wrangler dev (local Worker + local D1)
bun run db:migrate:local    # apply migrations to local D1
bun run db:migrate:remote   # apply migrations to production D1
bun run typecheck           # tsc for worker code, then for browser code (src/client/tsconfig.json)
bun test                    # unit tests (pure functions only)
bun run smoke               # end-to-end test against the running dev server (--keep to inspect)
bun run deploy              # build, then wrangler deploy
```

Production secrets (run once per secret):

```sh
bunx wrangler secret put ADMIN_EMAIL
bunx wrangler secret put ADMIN_PASSWORD
bunx wrangler secret put SESSION_SECRET
```

## Before finishing a change

`bun run typecheck && bun test`, then with `bun run dev` running: `bun run smoke`. Update MAP.md.

## Conventions

- TypeScript `strict`. No `any` unless commented why.
- API responses are JSON. Errors are `{ "error": string }` with the right HTTP status.
- IDs are `crypto.randomUUID()`. Campaign `slug` is a short random string used in the public URL.
- Timestamps are stored as ISO-8601 UTC strings.
- SQL lives only in `src/worker/lib/db.ts`, and always uses bound parameters (`?`).
