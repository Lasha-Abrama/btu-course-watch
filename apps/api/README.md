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
- Owned watches: `GET /api/v1/watches`, `PUT /api/v1/watches` (`{ "btuCourseId": "665", "btuGroupId": "13344" }`), `DELETE /api/v1/watches/:watchId` (web access cookie; mutations retain origin/CSRF protection)
- Extension link review/approval/list/revocation: `GET /api/v1/extension/link-requests/:requestId`, `POST /api/v1/extension/link-requests/:requestId/approve`, `GET /api/v1/extension/authorizations`, `POST /api/v1/extension/authorizations/:authorizationId/revoke` (normal web access cookie and existing origin protection)
- Extension-only initiation/exchange/status/submission: `POST /api/v1/extension/link-requests`, `POST /api/v1/extension/link-requests/:requestId/exchange`, `GET /api/v1/extension/status`, `POST /api/v1/extension/observations` (dedicated extension transport; status/submission require scoped bearer)
- Extension-owned watches: `GET /api/v1/extension/watches`, `PUT /api/v1/extension/watches`, `DELETE /api/v1/extension/watches/:watchId` (dedicated extension bearer; no web cookies)

The Prisma models include application authentication, shared canonical `Course`, `Group`, and `GroupStateChange` state, and user-owned `Watch` rows; there is no per-scan observation table or inferred academic-term model. A watch references the internal canonical Group UUID and is unique per user/group. Unwatch hard-deletes the row because no notification history exists yet. Repeated create/delete requests are idempotent; missing canonical groups are never fabricated. Responses join last-known shared state and omit Choose URLs. Observation ingestion accepts only the shared structured contract, never Classroom HTML or credentials. The API does not retain submitting-user identity on shared state. See the root README for the `UNKNOWN`/stale-update policy and extension boundary. Verification and reset emails link to the frontend origin configured by `CORS_ORIGIN`. `SMTP_USER` and `SMTP_PASSWORD` are optional as a pair for unauthenticated local SMTP servers. Docker Compose does not start an SMTP server. Configure the Google Cloud OAuth Web client and all four `GOOGLE_*` variables as described in the root README before starting the API.

The extension authorization is separate from application cookies. A link request is valid for five minutes; approval requires a verified, signed-in user and the existing trusted web origin. Exchange requires a locally generated high-entropy verifier whose challenge hash is stored server-side, can be used only once, and issues a 90-day credential scoped to structured observation submission and that user's watches. The API stores only the credential hash, expiry, revocation, and last-used timestamp. A different origin is rejected when supplied; missing Origin is tolerated only on dedicated cookie-rejecting extension routes because browser/service-worker header behavior varies. Authentication never relies on Origin or extension ID alone. The normal `/observations` route still requires web cookies and its original CSRF policy. Deploy edge/IP rate limits for public link initiation and exchange endpoints.

Web logout revokes the web session, not a separately approved extension authorization. Use `/extension-link` to revoke the latter explicitly; uninstalling the extension alone does not revoke its server-side record.

PostgreSQL ingestion and extension lifecycle tests run only when `OBSERVATION_TEST_DATABASE_URL` points to a separately migrated database named `btu_course_watch_phase5a_test`; otherwise they are skipped. Create that database locally, apply migrations to it with `DATABASE_URL=<test-database-url> pnpm --filter api exec prisma migrate deploy`, then run `OBSERVATION_TEST_DATABASE_URL=<test-database-url> pnpm test`. Never point this variable at development or production data.
