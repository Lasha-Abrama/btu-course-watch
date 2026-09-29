# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm/Turborepo monorepo. `apps/api` contains the NestJS 12, TypeScript 6, ESM API; its Prisma schema and migrations live in `apps/api/prisma`, and HTTP integration tests live in `apps/api/test`. `apps/web/src/app` contains the Next.js App Router pages. `apps/extension/src` contains the Chrome Manifest V3 popup and service worker; `apps/extension/vite.config.ts` generates the manifest in `dist`. Shared observation types belong in `packages/contracts`; DOM parsing belongs in `packages/classroom-parser`, with sanitized HTML fixtures in `test/fixtures`. Keep product logic out of the extension popup.

## Build, Test & Development Commands

Use Node.js 24 and pnpm 12.6.0. Run `pnpm install --frozen-lockfile` to restore dependencies. For local API/web development, copy the relevant `.env.example` files, start PostgreSQL with `docker compose up -d`, apply migrations with `pnpm --filter api exec prisma migrate deploy`, then run `pnpm dev`. `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` run across the workspace. `pnpm format` applies Prettier (and Prisma formatting); `pnpm db:validate` checks the schema. Use a filter for focused work, for example `pnpm --filter @btu-course-watch/extension test`.

## Coding Style & Naming Conventions

Follow each package's existing Prettier output (two-space indentation) and Oxlint rules. Keep TypeScript strict, preserve the API's ESM imports and Vitest setup, and use kebab-case filenames such as `course-observation.ts`. Put shared serializable contracts in `packages/contracts`; do not duplicate parser rules in the extension. Make Prisma changes through migrations, not `db:push`.

## Testing Guidelines

Use Vitest. Name unit tests `*.spec.ts`; API HTTP tests use `*.e2e-spec.ts`. Add focused tests for changed behavior and sanitized fixtures for parser cases. No numeric coverage threshold is configured. Run relevant package tests plus workspace checks before a PR, and finish with `git diff --check`.

## Commit & Pull Request Guidelines

Recent commits use concise Conventional Commit-style subjects: `feat:`, `fix:`, or `chore:` followed by a lowercase imperative summary. No PR template is present. Describe scope, security implications, migrations or new configuration, and commands run; link the relevant issue when one exists. Include screenshots for visible UI changes and manual Chrome steps for extension changes.

## Security & Configuration

Never commit secrets or authenticated BTU HTML. BTU Classroom passwords, cookies, sessions, and authorization data must stay in the student's browser; the extension must not send them or raw page HTML to the API. Request only necessary Chrome permissions, and keep BTU Course Watch authentication separate from Classroom authentication.
