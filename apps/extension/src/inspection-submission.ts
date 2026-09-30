import type { CourseObservation } from "@btu-course-watch/contracts";
import type { SubmissionResult, WatchResult } from "./account.js";
import type {
  InspectionResult,
  InspectionSubmissionResult,
} from "./protocol.js";

export async function completeInspection(
  result: InspectionResult,
  submit: (observation: CourseObservation) => Promise<SubmissionResult>,
  list: () => Promise<WatchResult>,
): Promise<InspectionSubmissionResult> {
  if (!result.ok) return result;
  let submission: SubmissionResult;
  try {
    submission = await submit(result.observation);
  } catch {
    return {
      ...result,
      submission: { state: "SUBMISSION_FAILED" },
      watches: { state: "REQUEST_FAILED" },
    };
  }
  if (submission.state !== "SUBMITTED")
    return {
      ...result,
      submission,
      watches: {
        state:
          submission.state === "SUBMISSION_FAILED"
            ? "REQUEST_FAILED"
            : submission.state,
      },
    };
  try {
    return { ...result, submission, watches: await list() };
  } catch {
    return { ...result, submission, watches: { state: "REQUEST_FAILED" } };
  }
}
