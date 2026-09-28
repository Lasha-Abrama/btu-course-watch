import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    DATABASE_URL: z.string().min(1).startsWith('postgresql://'),
    CORS_ORIGIN: z.url().default('http://localhost:3000'),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    API_PUBLIC_URL: z.url(),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true'),
    SMTP_FROM: z.email(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
      context.addIssue({
        code: 'custom',
        message: 'SMTP_USER and SMTP_PASSWORD must be set together',
      });
    }

    if (
      value.NODE_ENV === 'production' &&
      !value.API_PUBLIC_URL.startsWith('https://')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'API_PUBLIC_URL must use HTTPS in production',
      });
    }
    if (new URL(value.CORS_ORIGIN).origin !== value.CORS_ORIGIN) {
      context.addIssue({
        code: 'custom',
        message: 'CORS_ORIGIN must be an exact origin without a path',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      !value.CORS_ORIGIN.startsWith('https://')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'CORS_ORIGIN must use HTTPS in production',
      });
    }
    if (value.COOKIE_SAME_SITE === 'none' && value.NODE_ENV !== 'production') {
      context.addIssue({
        code: 'custom',
        message: 'SameSite=None requires production HTTPS cookies',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  environment: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  }

  return result.data;
}
