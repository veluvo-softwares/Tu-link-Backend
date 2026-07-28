# Tulink Monorepo

This repository now hosts the Tulink monorepo.

- `apps/api` contains the NestJS backend
- `apps/dashboard` will host the Clerk-based operator dashboard
- `packages/ui` will hold shared UI tokens and primitives

The first migration phase keeps the backend behavior intact while the workspace
layout, CI, and deployment paths are updated.

Environment files:
- copy [`.env.example`](./.env.example) to `.env`
- copy [`apps/dashboard/.env.example`](./apps/dashboard/.env.example) to `apps/dashboard/.env`

Clerk only needs two values for phase 1:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

For webhook-based org syncing, also add:
- `CLERK_WEBHOOK_SIGNING_SECRET`

The live dashboard map also needs a URL-restricted Mapbox public token:
- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`

Docker development:
- `npm start` builds and runs the dashboard, API, Postgres, and Redis
- `npm start api` builds and runs the API plus its Postgres/Redis dependencies
- `npm start dashboard` builds and runs the dashboard and its full dependency graph
- `npm start postgres redis` runs only local infrastructure
- `npm run docker:build -- api dashboard` builds selected application images
- `npm stop` stops the local stack

Host-based development:
- `npm run dev` starts Postgres + Redis in Docker, then runs the monorepo apps with Turbo
- `npm run docker:down` stops the local containers

Ports:
- Postgres: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`

Development deployment:
- CI builds separate API and dashboard images
- pushes to `dev` build and restart `api-dev` and `dashboard-dev` on the droplet
- the droplet `.env` and CI environment both need `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- the droplet `.env` and CI environment both need `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`
- the droplet `.env` also provides the runtime-only `CLERK_SECRET_KEY`
- the reverse proxy must route the chosen dashboard hostname to `dashboard-dev:3001`
