# vote-counter

A simple app for voting during Toastmasters sessions, hosted on Cloudflare (Worker + D1).

- Agents: start with [CLAUDE.md](CLAUDE.md)
- Every file is described in [MAP.md](MAP.md)
- Design details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Quick start

```sh
cp .env.example .env              # then edit the values
bun install
bunx wrangler d1 create vote-counter   # paste the database_id into wrangler.jsonc
bun run db:migrate:local
bun run dev
```
