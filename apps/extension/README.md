# BTU Classroom Groups inspection (Phase 4)

This Manifest V3 extension inspects only the active BTU Classroom **Groups** page when the user clicks **Inspect this page**. It accepts the exact HTTPS route `/ge/student/me/course/groups/{btuCourseId}/{opaqueRouteParam}` on `classroom.btu.edu.ge`. The first segment is BTU's observed course ID and stays a string; the second segment's meaning is unknown and is not modeled. The My Courses list (`/ge/student/me/index/3`), ordinary subject pages, and Syllabus are not Groups pages.

The popup asks the extension service worker to inspect the active tab. The worker validates the URL, fetches that exact page with `credentials: "include"` and `redirect: "manual"`, and calls the existing `@btu-course-watch/classroom-parser` on the returned HTML. This asks Chrome to use the student's existing Classroom authentication; the extension never reads passwords, cookies, session tokens, or authorization headers. HTML exists only transiently in the worker and is not logged, stored, messaged to the popup, or sent to the BTU Course Watch API. Only a structured `CourseObservation` or a fixed error code reaches the popup. The popup shows whether a Choose action exists but never shows or follows its URL.

The manifest grants only the host permission `https://classroom.btu.edu.ge/*`, which lets Chrome reveal matching tab URLs and lets the worker fetch that host. Non-BTU tab URLs are not read. It has no `activeTab`, `cookies`, `tabs`, `scripting`, `storage`, notifications, or API/backend permission. No scheduled request runs.

## Manual test with your own BTU account

1. Run `pnpm install --frozen-lockfile` and `pnpm --filter @btu-course-watch/extension build` at the repository root.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `apps/extension/dist`. Reload the extension there after each rebuild.
3. In a normal Chrome tab, sign in to BTU Classroom normally. Open **My Courses**, open a specific subject, then select its **Groups** section. Check that the tab URL has the form `https://classroom.btu.edu.ge/ge/student/me/course/groups/<course ID>/<opaque segment>`.
4. Open the extension popup and click **Inspect this page**. Verify the course ID matches the first route segment and that the timestamp, group count, group IDs, names, capacities, statuses, and Choose-action presence match the page. No action is taken on a group.
5. Open the extension on a random website: it should say to open BTU Classroom. On My Courses or a subject's non-Groups/Syllabus page, it should say to open Groups. On `/ge/login`, or when a Groups-page request redirects after logout, it should ask you to sign in again. When selection mode is disabled, affected groups should show `UNKNOWN` with no Choose action; quota-full groups should show `FULL`.

Real BTU/Chrome behavior still needs this manual check: whether the worker's credentialed fetch receives the same authenticated Groups markup as the tab, whether the group rows are present in the server response rather than inserted later by page JavaScript, and whether all login responses are recognizable. If the worker cannot access the authenticated markup, stop and report the observation before considering page-context access or more permissions. Do not capture or commit a full authenticated page or credentials.
