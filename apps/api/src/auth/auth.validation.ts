import { z } from 'zod';

const btuEmailSchema = z
  .string()
  .transform((email) => email.trim().toLowerCase())
  .pipe(
    z
      .email()
      .max(254)
      .regex(/^[\x21-\x7e]+@btu\.edu\.ge$/),
  );

const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 256)
  .refine((password) => /\S/.test(password))
  .refine((password) => {
    const categories = [
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /[0-9]/.test(password),
      /[^a-zA-Z0-9]/.test(password),
    ];

    const isPassphrase =
      password.length >= 20 &&
      password
        .trim()
        .split(/\s+/)
        .filter((word) => word.length >= 3).length >= 3;

    return categories.filter(Boolean).length >= 3 || isPassphrase;
  });

export const registrationSchema = z.strictObject({
  email: btuEmailSchema,
  password: passwordSchema,
});

export const loginSchema = z.strictObject({
  email: btuEmailSchema,
  password: z.string().min(1).max(128),
});

export const resendVerificationSchema = z.strictObject({
  email: btuEmailSchema,
});

export const verifyEmailSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
