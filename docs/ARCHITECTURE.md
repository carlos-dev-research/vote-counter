# Architecture

## Overview

```
 Voter phone ──scan QR──► https://<host>/v/<slug>
                                │
                     ┌──────────▼───────────┐
                     │  Cloudflare Worker   │  src/worker/index.ts (Hono)
                     │  ├─ /api/*   (API)   │
                     │  ├─ /v/:slug (page)  │──► serves public/vote.html
                     │  └─ else → ASSETS    │──► public/ (static files)
                     └──────────┬───────────┘
                                │
                         ┌──────▼──────┐
                         │ Cloudflare  │
                         │     D1      │
                         └─────────────┘
```

There is one deployable unit: a Worker with Static Assets and a D1 binding. No separate
Pages project and no separate API service.

## Bun's role

Bun is the **tooling** runtime: package manager, client bundler (`bun build`), test runner,
and script runner for Wrangler. The **backend runs on Cloudflare's Workers runtime
(workerd)**, not Bun, so server code may use only Web-standard APIs and Workers bindings.
`BUN_VERSION` pins the Bun used for local work and for Cloudflare Workers Builds (CI),
where it is set as a build environment variable.

## Data model (D1)

| Table        | Columns                                                                                     |
|--------------|---------------------------------------------------------------------------------------------|
| `campaigns`  | `id` PK, `slug` UNIQUE, `name`, `status` (`draft`/`open`/`closed`), `created_at`, `opened_at`, `closed_at` |
| `categories` | `id` PK, `campaign_id` FK, `name`, `position`                                               |
| `candidates` | `id` PK, `category_id` FK, `name`, `position`                                               |
| `votes`      | `id` PK, `campaign_id` FK, `category_id` FK, `candidate_id` FK, `device_id`, `created_at`; **UNIQUE(`category_id`, `device_id`)** |

Vote counts are computed with `COUNT(*) … GROUP BY candidate_id`. There is no stored counter.

## Campaign lifecycle

```
draft ──open──► open ──close──► closed
```

- **draft:** the admin edits categories and candidates. The public page says "not open yet".
- **open:** voting allowed. The admin can't change categories or candidates.
- **closed:** voting rejected. The public page (same QR) shows the results.

## API

### Public (no auth)

| Method | Path                          | Purpose                                                                                       |
|--------|-------------------------------|-----------------------------------------------------------------------------------------------|
| GET    | `/api/campaigns/:slug`        | Campaign state. Draft: name only. Open: ballot plus this device's existing votes. Closed: results. |
| POST   | `/api/campaigns/:slug/votes`  | Body `{ votes: [{ categoryId, candidateId }] }`. Records one vote per category per device.      |

### Admin (session cookie required, except login)

| Method | Path                                          | Purpose                          |
|--------|-----------------------------------------------|----------------------------------|
| POST   | `/api/admin/login`                            | `{ email, password }` → sets session cookie |
| POST   | `/api/admin/logout`                           | Clears the session cookie        |
| GET    | `/api/admin/campaigns`                        | List campaigns                   |
| POST   | `/api/admin/campaigns`                        | Create campaign `{ name }`       |
| GET    | `/api/admin/campaigns/:id`                    | Campaign, categories, candidates, and live counts |
| POST   | `/api/admin/campaigns/:id/status`             | `{ status: "open" \| "closed" }` |
| DELETE | `/api/admin/campaigns/:id`                    | Delete campaign                  |
| POST   | `/api/admin/campaigns/:id/categories`         | Add category `{ name }`          |
| DELETE | `/api/admin/categories/:id`                   | Remove category                  |
| POST   | `/api/admin/categories/:id/candidates`        | Add candidate `{ name }`         |
| DELETE | `/api/admin/candidates/:id`                   | Remove candidate                 |
| GET    | `/api/admin/campaigns/:id/qr.svg`             | QR code (SVG) for `https://<host>/v/<slug>` |

The back office polls `GET /api/admin/campaigns/:id` every few seconds to show live counts.

## Authentication (back office)

- A single admin. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are Wrangler secrets (`.env` locally).
- Login compares both values in constant time. On success it sets the cookie
  `vc_admin = <expiresAt>.<HMAC-SHA256(SESSION_SECRET, expiresAt)>` with the attributes
  `HttpOnly; Secure; SameSite=Strict; Path=/api/admin`, valid for 12 hours.
- The `requireAdmin` middleware verifies the HMAC and the expiry on every admin route.
- Because the cookie is `SameSite=Strict` and the API only accepts JSON, a separate CSRF
  token is not needed.

## One vote per device

**About MAC addresses:** a web page cannot read a device's MAC address. Browsers don't
expose it, and it isn't sent over the internet (routers replace it at each hop). So the app
uses a **device-ID cookie**:

- The first API call from a browser sets `vc_device = <uuid>.<HMAC(SESSION_SECRET, uuid)>`
  (`HttpOnly; Secure; SameSite=Lax`, valid for 1 year). Because it is signed, a client can't
  make up IDs.
- `votes` has `UNIQUE(category_id, device_id)`, so the database rejects a second vote in the
  same category. The API returns `409` in that case.

**Known limitation:** someone who clears cookies, opens a private window, or switches
browsers gets a new device ID. That's acceptable for a club vote. If it isn't, possible later
additions are an IP + user-agent rate limit, or Cloudflare Turnstile.

## Front end

Plain HTML pages in `public/`, each with one bundled script:

| Page          | URL            | Script                 |
|---------------|----------------|------------------------|
| `index.html`  | `/`            | none (landing page)    |
| `login.html`  | `/login`       | `src/client/login.ts`  |
| `admin.html`  | `/admin`       | `src/client/admin.ts`  |
| `vote.html`   | `/v/:slug`     | `src/client/vote.ts`   |

`bun build` writes the scripts to `public/assets/*.js` (git-ignored build output).

## Configuration

| Name             | Where                         | Purpose                                   |
|------------------|-------------------------------|-------------------------------------------|
| `BUN_VERSION`    | `.env`, Workers Builds env    | Pinned Bun version for build and tooling  |
| `ADMIN_EMAIL`    | `.env` / `wrangler secret`    | Admin username                            |
| `ADMIN_PASSWORD` | `.env` / `wrangler secret`    | Admin password                            |
| `SESSION_SECRET` | `.env` / `wrangler secret`    | HMAC key for session and device cookies   |
| `DB`             | `wrangler.jsonc` binding      | D1 database                               |
| `ASSETS`         | `wrangler.jsonc` binding      | Static assets from `public/`              |
