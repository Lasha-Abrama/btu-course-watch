# BTU Course Watch API

NestJS 12, TypeScript 6, ESM, Vitest, and Prisma API workspace.

Copy `.env.example` to `.env`, configure an SMTP server, start the repository PostgreSQL service with `docker compose up -d`, apply the migration with `pnpm --filter api exec prisma migrate deploy`, then run `pnpm --filter api start:dev` from the repository root.

- Health: `GET http://localhost:3001/api/v1/health`
- Swagger UI: `http://localhost:3001/api/docs`
- OpenAPI JSON: `http://localhost:3001/api/docs/openapi.json`
- Registration: `POST /api/v1/auth/register`
- Email verification: `POST /api/v1/auth/verify-email`
- Resend verification: `POST /api/v1/auth/resend-verification`
- Password recovery: `POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/reset-password`
- Password login: `POST /api/v1/auth/login`
- Google sign-in: `GET /api/v1/auth/google` (callback: `GET /api/v1/auth/google/callback`)
- Session renewal/logout: `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`
- Current user: `GET /api/v1/users/me`
- Structured Groups-page ingestion: `POST /api/v1/observations` (access cookie + trusted origin)
- Shared last-known course state: `GET /api/v1/courses/:btuCourseId` (access cookie)

The Prisma models include application authentication and shared canonical `Course`, `Group`, and `GroupStateChange` state; there is no per-scan observation table or inferred academic-term model. Observation ingestion accepts only the shared structured contract, never Classroom HTML or credentials. The API does not retain submitting-user identity on shared state. See the root README for the `UNKNOWN`/stale-update policy and extension boundary. Verification and reset emails link to the frontend origin configured by `CORS_ORIGIN`. `SMTP_USER` and `SMTP_PASSWORD` are optional as a pair for unauthenticated local SMTP servers. Docker Compose does not start an SMTP server. Configure the Google Cloud OAuth Web client and all four `GOOGLE_*` variables as described in the root README before starting the API.

PostgreSQL ingestion tests run only when `OBSERVATION_TEST_DATABASE_URL` points to a separately migrated database named `btu_course_watch_phase5a_test`; otherwise those seven tests are skipped. Create that database locally, apply migrations to it with `DATABASE_URL=<test-database-url> pnpm --filter api exec prisma migrate deploy`, then run `OBSERVATION_TEST_DATABASE_URL=<test-database-url> pnpm test`. Never point this variable at development or production data.
