# BTU Course Watch API

NestJS 12, TypeScript 6, ESM, Vitest, and Prisma API workspace.

Copy `.env.example` to `.env`, configure an SMTP server, start the repository PostgreSQL service with `docker compose up -d`, apply the migration with `pnpm --filter api exec prisma migrate deploy`, then run `pnpm --filter api start:dev` from the repository root.

- Health: `GET http://localhost:3001/api/v1/health`
- Swagger UI: `http://localhost:3001/api/docs`
- OpenAPI JSON: `http://localhost:3001/api/docs/openapi.json`
- Registration: `POST /api/v1/auth/register`
- Email verification: `POST /api/v1/auth/verify-email`
- Resend verification: `POST /api/v1/auth/resend-verification`
- Password login: `POST /api/v1/auth/login`
- Google sign-in: `GET /api/v1/auth/google` (callback: `GET /api/v1/auth/google/callback`)
- Session renewal/logout: `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`
- Current user: `GET /api/v1/users/me`

The Prisma models are limited to users, email verification, application sessions, and Google identity. Tokens are delivered by email because no frontend verification page exists. `SMTP_USER` and `SMTP_PASSWORD` are optional as a pair for unauthenticated local SMTP servers. Docker Compose does not start an SMTP server. Configure the Google Cloud OAuth Web client and all four `GOOGLE_*` variables as described in the root README before starting the API.
