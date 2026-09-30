# BTU Classroom course-page parser

`parseCoursePage(html, { btuCourseId, observedAt, courseName? })` is a synchronous, deterministic transformation. The caller supplies already-obtained HTML and a canonical UTC ISO timestamp; the package uses no browser globals, cookies, credentials, network access, backend state, or clock. It does not click, navigate to, or construct an enrollment URL. Its output is the serializable `CourseObservation` contract from `@btu-course-watch/contracts`.

`discoverGroupsUrl(subjectHtml, subjectUrl, btuCourseId)` reads ordinary anchor hrefs from already-fetched subject-page HTML. It accepts only one distinct exact HTTPS Classroom Groups URL for the requested course (identical duplicate anchors are fine), resolving safe relative hrefs without executing scripts. It returns `null` for missing, mismatched, unsafe, or ambiguous links. The second Groups-route segment is opaque and never constructed or interpreted. Two authenticated subject-page responses were manually confirmed to expose Groups anchors for courses `665` and `672`; this is not a guarantee for every course or academic period.

## Confirmed evidence and conservative rules

- A visible `.group_title[data-id]` supplies `btuGroupId`, an external BTU key for this project. No undocumented internal meaning is assumed.
- The suffix `name - (digits)` supplies a trimmed name and non-negative capacity. Other title text is preserved as the name with `capacity: null`.
- A real authenticated group row confirmed that `.group_title[data-id]` and its corresponding `.chooseGroup` control share one `<tr>`. A group action is considered only when exactly one visible `a.chooseGroup` shares that row and it contains exactly one visible group title. No positional matching across rows is used.
- `AVAILABLE` requires an enabled `btn-primary` action with `data-type="choose"` and an absolute HTTPS `data-href` on exactly `classroom.btu.edu.ge` matching `/ge/student/me/choose/<digits>`, without query, fragment, or credentials. `disabled`, `aria-disabled="true"`, and a `disabled` class prevent an available classification. The URL is taken from the DOM; the selection number need not equal `btuGroupId`.
- `FULL` requires a `btn-default chooseGroup` action with a `disabled` attribute, no non-empty `data-href`, and the confirmed quota message `data-msg="ჯგუფში კვოტა შევსებულია"` (whitespace-normalized). These structural checks and the message are all needed: the same disabled control with `data-msg="არჩევის რეჟიმი გამორთულია"` means selection mode is disabled, so its status is `UNKNOWN`. Missing or other messages are also `UNKNOWN`; neither state exposes a Choose URL.
- Other or conflicting controls, multiple titles in a row, missing controls, and invalid URLs yield `UNKNOWN` and `chooseUrl: null`. A missing/blank or duplicate group key fails explicitly instead of producing a misleading observation. Groups are returned in stable ID order.
- The parser ignores structurally hidden titles and actions (`hidden`, `aria-hidden="true"`, or inline `display: none`). It cannot evaluate external stylesheets or computed visibility.

The fixture detail rows `tr-<btuGroupId>` and icons `ico-<btuGroupId>` reflect the manually noted correspondence. They are not parsed for schedule or lecturer fields: no sufficiently specific real detail-row structure was supplied. `courseName` is caller-provided context, never guessed from page text.

An unrelated browser extension was observed injecting rating/star badges beside groups in rendered pages. Browser-assisted checks parse **network response HTML**, not another extension's rendered DOM. A sanitized badge fixture also verifies that adjacent decoration does not affect group identity, capacity, status, or Choose extraction; no rating or instructor field belongs to `CourseObservation`.

## Unsupported until more sanitized evidence is captured

Controls outside the title row; relative or non-`/ge/` Choose URLs; alternative action elements/classes; group titles hidden only by external CSS; and structured lecturer/schedule extraction. A sanitized expanded detail row would let us evaluate any schedule/lecturer fields later. Do not add a full authenticated page or any user identity, cookies, authorization data, or tokens to fixtures.

Run `pnpm --filter @btu-course-watch/classroom-parser test` for the fixture suite. The package does not send observations to the API or persist HTML.
