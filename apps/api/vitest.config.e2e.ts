import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      CORS_ORIGIN: 'http://localhost:3000',
      DATABASE_URL:
        'postgresql://btu_course_watch:btu_course_watch@localhost:5432/btu_course_watch_test?schema=public',
      NODE_ENV: 'test',
    },
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
