export const HEALTH_KEY = "monitoringHealth";
export const CURSOR_KEY = "monitoringCursor";

/** Monitoring history belongs only to the current Course Watch link. */
export async function clearMonitoringState(storage: {
  remove(key: string): Promise<void>;
}): Promise<void> {
  await storage.remove(HEALTH_KEY);
  await storage.remove(CURSOR_KEY);
}
