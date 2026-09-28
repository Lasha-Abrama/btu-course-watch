import { z } from "zod";

const clientEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
});

export const clientEnvironment = clientEnvironmentSchema.parse({
  NEXT_PUBLIC_API_URL:
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1",
});
