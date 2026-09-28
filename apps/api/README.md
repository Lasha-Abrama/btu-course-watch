# BTU Course Watch API

NestJS 12, TypeScript 6, ESM, Vitest, and Prisma API workspace.

Copy `.env.example` to `.env`, start the repository PostgreSQL service with `docker compose up -d`, then run `pnpm --filter api start:dev` from the repository root.

- Health: `GET http://localhost:3001/api/v1/health`
- Swagger UI: `http://localhost:3001/api/docs`
- OpenAPI JSON: `http://localhost:3001/api/docs/openapi.json`

The Prisma schema intentionally has no domain models yet.
