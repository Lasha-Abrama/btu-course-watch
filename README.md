# BTU Course Watch

Production-oriented monorepo for a BTU course availability monitoring platform. The API currently supports BTU email registration, verification, and application sessions; course monitoring is not implemented yet.

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
pnpm --filter api exec prisma migrate deploy
pnpm dev
```

The API defaults to `http://localhost:3001`, its health endpoint is `http://localhost:3001/api/v1/health`, Swagger is at `http://localhost:3001/api/docs`, and the web app defaults to `http://localhost:3000`.

Before registration can deliver email, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, and `API_PUBLIC_URL` in `apps/api/.env`. Set `SMTP_USER` and `SMTP_PASSWORD` together if your SMTP server requires authentication. Docker Compose starts PostgreSQL only; it does not provide an SMTP server. Production requires HTTPS for `API_PUBLIC_URL` and TLS for SMTP.

The first Prisma migration creates `User` and `EmailVerificationToken`; `20260928010000_auth_sessions` adds `AuthSession` and `RefreshToken`. On an existing checkout, apply pending migrations with `pnpm --filter api exec prisma migrate deploy`. Avoid `db:push` for tracked schema changes.

## Email verification milestone

`POST /api/v1/auth/register` accepts a BTU email and a password for this platform. The email must be an ASCII address at exactly `btu.edu.ge`; surrounding whitespace is removed and the address is lowercased. Passwords need 12–128 characters with at least three character types, or a passphrase of at least 20 characters and three words of at least three characters each. The API sends a one-time token by email. Submit it as `{"token":"TOKEN_FROM_EMAIL"}` to `POST /api/v1/auth/verify-email`. `POST /api/v1/auth/resend-verification` accepts `{"email":"student@btu.edu.ge"}` after a 60-second cooldown.

Tokens expire after 24 hours. Registration duplicates and resend requests return the same accepted response regardless of account status. If SMTP delivery fails, the API logs a generic warning and the unverified user can request another token after the cooldown. There is no frontend verification page yet.

Never submit BTU Classroom passwords, cookies, sessions, or authorization credentials to this platform. The registration password is solely for BTU Course Watch.

## Application sessions

After email verification, `POST /api/v1/auth/login` accepts the registered BTU Course Watch email and password. Successful login responds `204` and sets two host-only `HttpOnly` cookies: `bcw_access` (15 minutes, path `/api/v1`) and `bcw_refresh` (absolute 30-day session, path `/api/v1/auth`). `GET /api/v1/users/me` requires the access cookie and returns only the user ID, email, and verification timestamp. `POST /api/v1/auth/refresh` rotates both tokens, invalidates the previous access token, and does not extend the session's absolute lifetime. Reuse of a rotated refresh token revokes its entire session. `POST /api/v1/auth/logout` revokes the session and clears both cookies. Tokens are random and only their SHA-256 hashes are stored in PostgreSQL; refresh-token history is retained for reuse detection. The API does not return tokens in JSON.

For local development, cookies use `SameSite=Lax` and are not `Secure` on HTTP localhost. Production cookies are always `Secure`, and both `API_PUBLIC_URL` and `CORS_ORIGIN` must use HTTPS. Set `COOKIE_SAME_SITE=none` only for a production cross-site frontend/API deployment; keep `lax` for same-site deployment. Browser clients on the separate Next.js origin must use `credentials: 'include'`. The API permits credentialed CORS only for the exact configured `CORS_ORIGIN`. Nest's cross-origin request protection rejects unsafe requests from other browser origins, including same-site sibling origins; the configured frontend origin is explicitly trusted. Do not configure a wildcard origin. A production reverse proxy must preserve the request's `Host`, `Origin`, and `Sec-Fetch-Site` headers and serve HTTPS. Cross-site deployments also depend on browser third-party-cookie policy; a same-site deployment is preferable.

This session is for BTU Course Watch only. It does not accept or store BTU Classroom credentials. Login has no frontend page or extension flow yet.

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

Build with `pnpm --filter @btu-course-watch/extension build`, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist`.

The extension requests no host permissions and contains only a popup plus a minimal module service worker.
