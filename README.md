# BTU Course Watch

Production-oriented monorepo for a BTU course availability monitoring platform. The API and web app support BTU email registration, verification, password login, Google sign-in, password recovery, and application sessions; course monitoring is not implemented yet.

## Workspace

- `apps/api` — NestJS 12 ESM API; application routes live under `/api/v1` and Swagger is served at `/api/docs`.
- `apps/web` — Next.js TypeScript application using the App Router.
- `apps/extension` — Chrome Manifest V3 TypeScript extension for manual, local Groups-page inspection.
- `packages/contracts` — framework-neutral TypeScript contracts shared by applications.
- `packages/classroom-parser` — pure, fixture-tested BTU Classroom course-page HTML parser, used locally by the extension.
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
pnpm --filter api exec prisma migrate deploy
pnpm dev
```

The API defaults to `http://localhost:3001`, its health endpoint is `http://localhost:3001/api/v1/health`, Swagger is at `http://localhost:3001/api/docs`, and the web app defaults to `http://localhost:3000`.

Before registration or recovery can deliver email, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, and the exact frontend `CORS_ORIGIN` in `apps/api/.env`. Set `SMTP_USER` and `SMTP_PASSWORD` together if your SMTP server requires authentication. Docker Compose starts PostgreSQL only; it does not provide an SMTP server. Production requires HTTPS for the API and frontend and TLS for SMTP. Set `NEXT_PUBLIC_API_URL` in `apps/web/.env.local` to the browser-reachable API `/api/v1` URL.

The first Prisma migration creates `User` and `EmailVerificationToken`; `20260928010000_auth_sessions` adds `AuthSession` and `RefreshToken`; `20260928020000_google_identity` makes `User.passwordHash` nullable and adds `GoogleIdentity`; `20260929000000_password_reset` adds `PasswordResetToken`; `20260929010000_course_observations` adds canonical `Course`, `Group`, and `GroupStateChange` state. On an existing checkout, apply pending migrations with `pnpm --filter api exec prisma migrate deploy`. Avoid `db:push` for tracked schema changes.

## Email verification milestone

`POST /api/v1/auth/register` accepts a BTU email and a password for this platform. The email must be an ASCII address at exactly `btu.edu.ge`; surrounding whitespace is removed and the address is lowercased. Passwords need 12–128 characters with at least three character types, or a passphrase of at least 20 characters and three words of at least three characters each. The API sends a one-time token by email. Submit it as `{"token":"TOKEN_FROM_EMAIL"}` to `POST /api/v1/auth/verify-email`. `POST /api/v1/auth/resend-verification` accepts `{"email":"student@btu.edu.ge"}` after a 60-second cooldown.

Tokens expire after 24 hours. Registration duplicates and resend requests return the same accepted response regardless of account status. If SMTP delivery fails, the API logs a generic warning and the unverified user can request another token after the cooldown. Email links open `/verify-email#token=...` on the frontend; the page clears the fragment from browser history before submitting it to the API. The raw token is not stored in the database or browser storage.

Never submit BTU Classroom passwords, cookies, sessions, or authorization credentials to this platform. The registration password is solely for BTU Course Watch.

## Application sessions

After email verification, `POST /api/v1/auth/login` accepts the registered BTU Course Watch email and password. Successful login responds `204` and sets two host-only `HttpOnly` cookies: `bcw_access` (15 minutes, path `/api/v1`) and `bcw_refresh` (absolute 30-day session, path `/api/v1/auth`). `GET /api/v1/users/me` requires the access cookie and returns only the user ID, email, and verification timestamp. `POST /api/v1/auth/refresh` rotates both tokens, invalidates the previous access token, and does not extend the session's absolute lifetime. Reuse of a rotated refresh token revokes its entire session. `POST /api/v1/auth/logout` revokes the session and clears both cookies. Tokens are random and only their SHA-256 hashes are stored in PostgreSQL; refresh-token history is retained for reuse detection. The API does not return tokens in JSON.

For local development, cookies use `SameSite=Lax` and are not `Secure` on HTTP localhost. Production cookies are always `Secure`, and both `API_PUBLIC_URL` and `CORS_ORIGIN` must use HTTPS. Set `COOKIE_SAME_SITE=none` only for a production cross-site frontend/API deployment; keep `lax` for same-site deployment. Browser clients on the separate Next.js origin must use `credentials: 'include'`. The API permits credentialed CORS only for the exact configured `CORS_ORIGIN`. Nest's cross-origin request protection rejects unsafe requests from other browser origins, including same-site sibling origins; the configured frontend origin is explicitly trusted. Do not configure a wildcard origin. A production reverse proxy must preserve the request's `Host`, `Origin`, and `Sec-Fetch-Site` headers and serve HTTPS. Cross-site deployments also depend on browser third-party-cookie policy; a same-site deployment is preferable.

This session is for BTU Course Watch only. It does not accept or store BTU Classroom credentials. The Next.js client uses `credentials: 'include'` and never reads the HttpOnly cookies. Its shared profile request attempts one refresh on a `401`, coalesces simultaneous refreshes, and retries each request once. The home page reflects `/users/me` and calls the backend logout endpoint; `RequireAuth` is available for future protected pages. There is no extension auth yet.

## Google sign-in

Create a Google Cloud OAuth 2.0 **Web application** client, configure its OAuth consent screen, and request only the `openid` and `email` scopes. If the consent screen remains in testing mode, add the BTU Google accounts you will use as test users. Add the exact API callback URI (locally `http://localhost:3001/api/v1/auth/google/callback`) to **Authorized redirect URIs**; scheme, host, port, path, and trailing slash must match. Copy its client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `apps/api/.env`; never commit real credentials. Set `GOOGLE_CALLBACK_URL` to that same exact URI. Set `GOOGLE_POST_AUTH_REDIRECT_URL` to one fixed path on `CORS_ORIGIN` (locally `http://localhost:3000/`). Production requires HTTPS. These four variables are required for API startup. The example values are placeholders, not usable credentials. See [Google's web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server) for Cloud Console steps.

A browser starts at `GET /api/v1/auth/google` from the `/login` page. Google returns to `GET /api/v1/auth/google/callback`; a successful callback issues the existing application access/refresh cookies and redirects only to `GOOGLE_POST_AUTH_REDIRECT_URL` (locally `/`). The OAuth state is bound to a short-lived, signed `HttpOnly` cookie; no Express session, Google access token, or Google refresh token is stored. Failure returns a generic `401`. Client-supplied redirect parameters are ignored.

## Password recovery and web auth

The web app provides `/login`, `/register`, `/verify-email`, `/forgot-password`, and `/reset-password`. Registration requires an exact `@btu.edu.ge` address and email verification. `POST /api/v1/auth/forgot-password` returns the same `202` message for unknown, unverified, Google-only, cooling-down, and eligible accounts; only verified accounts with a local password receive mail. Reset email links open `/reset-password#token=...` on the configured frontend origin. URL fragments are not sent in HTTP requests, and the page removes the fragment from browser history on load. Both token pages have `Referrer-Policy: no-referrer` and `Cache-Control: no-store` headers. Do not put links or tokens in logs.

Reset tokens are generated from 32 secure random bytes, stored only as SHA-256 hashes, expire after 30 minutes, are single-use, and are replaced by a new request after a 60-second per-account email cooldown. `POST /api/v1/auth/reset-password` applies the same password policy and Argon2id hashing as registration and atomically consumes the token, changes the password, and revokes all application sessions. The user must sign in again. Resetting a Google-only account through this flow is not allowed; use Google sign-in. A user who linked Google to an existing password account retains both sign-in methods after reset. For production, configure network-level/IP rate limits on public auth endpoints and protect SMTP from abuse; the in-app cooldown alone is not a complete abuse control. Do not use BTU Classroom credentials.

Only Google's explicitly verified email at exactly `btu.edu.ge` is accepted. The Google subject—not email—is the permanent provider identifier. An existing *verified* same-email password account is linked without changing its password. An unverified password account is not auto-linked, to avoid turning a pre-claimed account into a verified account whose password another person knows. One Google subject maps to one user and one user may have at most one Google identity; subject/email changes or conflicting identities fail closed and require manual resolution. Google-only users have no local password and cannot use password login. This milestone treats Google's `email_verified` claim as sufficient for email-based linking, but it does not prove Google Workspace membership or continuing control if the address is later reassigned. This flow never accesses BTU Classroom credentials or sessions.

## Quality commands

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm db:validate
pnpm --filter api exec prisma migrate status
pnpm format
```

## Chrome extension

Build with `pnpm --filter @btu-course-watch/extension build`, then load `apps/extension/dist` through Chrome's **Load unpacked** flow. After signing in to BTU Classroom in a normal tab, open a subject's **Groups** page and click **Inspect this page** in the popup. The extension requests only `https://classroom.btu.edu.ge/*` host access; it fetches and parses the page locally with the existing browser session, without reading or sending BTU credentials or HTML. See the [extension manual-test guide](apps/extension/README.md) for exact steps and expected error states. No monitoring or extension-to-API submission exists.

## Structured observation ingestion (Phase 5A)

`POST /api/v1/observations` accepts the existing `CourseObservation` JSON contract under the normal BTU Course Watch access cookie and trusted-origin protection. The body contains an opaque `btuCourseId`, a canonical UTC `observedAt`, nullable `courseName`, and 1–100 unique groups with IDs, names, capacities, statuses, and nullable validated BTU Choose URLs. Unknown fields, raw HTML, client-supplied user IDs, invalid URLs/timestamps, and payloads over 100 kB are rejected. A timestamp more than five minutes in the future is rejected to limit clock-skew poisoning. The API authenticates the submitting application user but does not retain their identity on shared course state. `GET /api/v1/courses/:btuCourseId` returns shared last-known course/group state and at most 20 recent discovery/status events, without user identities or Choose URLs. These endpoints are in Swagger at `/api/docs`.

The backend stores one `Course` per BTU course ID and one `Group` per `(course, BTU group ID)`, plus meaningful `GroupStateChange` events. First sightings are `DISCOVERED` with no fabricated previous status. A fresh definitive status change is `STATUS_CHANGED`; identical or stale scans do not add history. Each group ignores observations at or before its `lastObservedAt`. Missing groups are left untouched. A fresh `UNKNOWN` scan advances the observation time and clears any currently exposed Choose URL, but does not replace a previously definitive `AVAILABLE`/`FULL` status; `UNKNOWN` is a valid initial state. Availability is therefore **last known**, not guaranteed live. Transactions use PostgreSQL serializable isolation, uniqueness constraints, and bounded conflict retries for simultaneous submissions. No scan log or term model is created: the second Groups-route parameter's meaning remains unconfirmed.

Phase 5A intentionally leaves the extension's inspection-only behavior unchanged. Its existing Classroom permission and browser-local HTML parsing do not provide BTU Course Watch application authentication or a safe cross-origin CSRF design for API submission. Until that is designed separately, use authenticated API tests or a trusted development client to exercise ingestion. BTU passwords, cookies, sessions, authorization data, and raw HTML must remain browser-local and must never be posted to this API. The API cannot independently attest that a structured observation came from BTU; that trust boundary needs an explicit Phase 5B decision.

## Course-page parsing foundation (Phase 3)

The shared `CourseObservation` contract represents a caller-timestamped scan with BTU course/group IDs, nullable course name, group name/capacity, availability status, and a nullable, DOM-exposed Choose URL. `packages/classroom-parser` parses already-obtained HTML without credentials, network calls, browser globals, or backend state. It does not store HTML, navigate to Choose URLs, or implement monitoring. Its sanitized fixtures cover full, available, unknown, malformed, and newly appearing groups. The Chrome extension now uses this parser only for the confirmed `/ge/student/me/course/groups/{btuCourseId}/{opaqueRouteParam}` route; the second parameter's meaning remains unknown. See [parser assumptions and unsupported markup](packages/classroom-parser/README.md). BTU Classroom credentials and sessions must remain in the student's browser.
