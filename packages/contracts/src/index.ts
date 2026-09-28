/** Response returned by the API health endpoint. */
export interface HealthResponse {
  status: "ok";
  service: "btu-course-watch-api";
  timestamp: string;
}
