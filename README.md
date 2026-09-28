# BTU Course Watch

Production-oriented monorepo foundation for a BTU course availability monitoring platform. Product features are intentionally out of scope at this stage.

## Workspace

- `apps/api` — NestJS 12 ESM API; application routes live under `/api/v1` and Swagger is served at `/api/docs`.
- `apps/web` — Next.js TypeScript application using the App Router.
- `apps/extension` — minimal Chrome Manifest V3 TypeScript extension.
- `packages/contracts` — framework-neutral TypeScript contracts shared by applications.
- `compose.yaml` — PostgreSQL for local development.

## Prerequisites

- Node.js 24
- pnpm 12.6.0 (Corepack is recommended)
- Docker with Docker Compose

## Local setup

```bash
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
docker compose up -d
pnpm db:generate
pnpm dev
```

The API defaults to `http://localhost:3001`, its health endpoint is `http://localhost:3001/api/v1/health`, Swagger is at `http://localhost:3001/api/docs`, and the web app defaults to `http://localhost:3000`.

The Prisma schema currently defines only its PostgreSQL datasource and client generator. Add migrations only when the first product domain model is designed; `pnpm db:push` is provided for deliberate local schema synchronization, not run automatically.

## Quality commands

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm db:validate
pnpm format
```

## Chrome extension

Build with `pnpm --filter @btu-course-watch/extension build`, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist`.

The extension requests no host permissions and contains only a popup plus a minimal module service worker.
