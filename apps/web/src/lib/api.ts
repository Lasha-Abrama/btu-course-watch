import type { HealthResponse } from "@btu-course-watch/contracts";
import { clientEnvironment } from "./env";

export async function getApiHealth(): Promise<HealthResponse> {
  const response = await fetch(
    `${clientEnvironment.NEXT_PUBLIC_API_URL}/health`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`API health request failed with status ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}
