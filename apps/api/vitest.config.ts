import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      CORS_ORIGIN: 'http://localhost:3000',
      DATABASE_URL:
        'postgresql://btu_course_watch:btu_course_watch@localhost:5432/btu_course_watch_test?schema=public',
      NODE_ENV: 'test',
      API_PUBLIC_URL: 'http://localhost:3001',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'no-reply@btu.edu.ge',
    },
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
