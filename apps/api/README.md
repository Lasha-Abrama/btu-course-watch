# BTU Course Watch API

NestJS 12, TypeScript 6, ESM, Vitest, and Prisma API workspace.

Copy `.env.example` to `.env`, configure an SMTP server, start the repository PostgreSQL service with `docker compose up -d`, apply the migration with `pnpm --filter api exec prisma migrate deploy`, then run `pnpm --filter api start:dev` from the repository root.

- Health: `GET http://localhost:3001/api/v1/health`
- Swagger UI: `http://localhost:3001/api/docs`
- OpenAPI JSON: `http://localhost:3001/api/docs/openapi.json`
- Registration: `POST /api/v1/auth/register`
- Email verification: `POST /api/v1/auth/verify-email`
- Resend verification: `POST /api/v1/auth/resend-verification`

The current Prisma models are limited to users and email verification tokens. Tokens are delivered by email because no frontend verification page exists in this milestone. `SMTP_USER` and `SMTP_PASSWORD` are optional as a pair for unauthenticated local SMTP servers. Docker Compose does not start an SMTP server.
