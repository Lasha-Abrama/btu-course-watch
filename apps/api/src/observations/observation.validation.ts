import {
  assertCourseObservation,
  type CourseObservation,
} from '@btu-course-watch/contracts';
import { z } from 'zod';

const externalId = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/);

const groupSchema = z.strictObject({
  btuGroupId: externalId,
  name: z.string().min(1).max(500).nullable(),
  capacity: z.number().int().min(0).max(2_147_483_647).nullable(),
  status: z.enum(['AVAILABLE', 'FULL', 'UNKNOWN']),
  chooseUrl: z.string().max(2048).nullable(),
});

const observationSchema = z.strictObject({
  btuCourseId: externalId,
  observedAt: z.string(),
  courseName: z.string().min(1).max(500).nullable(),
  groups: z.array(groupSchema).min(1).max(100),
});

/** Strict API boundary on top of the parser's shared observation invariants. */
export function parseObservationPayload(
  value: unknown,
): CourseObservation | null {
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 100_000) return null;
    const result = observationSchema.safeParse(value);
    if (!result.success) return null;
    assertCourseObservation(result.data);
    if (Date.parse(result.data.observedAt) > Date.now() + 5 * 60_000)
      return null;
    return result.data;
  } catch {
    return null;
  }
}

export function isExternalId(value: string): boolean {
  return externalId.safeParse(value).success;
}
