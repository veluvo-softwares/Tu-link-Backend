# Tulink Monorepo

This repository now hosts the Tulink monorepo.

- `apps/api` contains the NestJS backend
- `apps/dashboard` will host the Clerk-based operator dashboard
- `packages/ui` will hold shared UI tokens and primitives

The first migration phase keeps the backend behavior intact while the workspace
layout, CI, and deployment paths are updated.

Environment files:
- copy [`.env.example`](./.env.example) to `.env`
- copy [`apps/dashboard/.env.example`](./apps/dashboard/.env.example) to `apps/dashboard/.env.local`

Clerk only needs two values for phase 1:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

For webhook-based org syncing, also add:
- `CLERK_WEBHOOK_SIGNING_SECRET`

Local infrastructure:
- `docker compose -p tulink up -d postgres redis` starts Postgres + Redis only
- `npm run dev` starts Postgres + Redis, then runs the monorepo apps with Turbo
- `npm run docker:down` stops the local containers

Ports:
- Postgres: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
