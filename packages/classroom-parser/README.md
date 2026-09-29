# BTU Classroom course-page parser

`parseCoursePage(html, { btuCourseId, observedAt, courseName? })` is a synchronous, deterministic transformation. The caller supplies already-obtained HTML and a canonical UTC ISO timestamp; the package uses no browser globals, cookies, credentials, network access, backend state, or clock. It does not click, navigate to, or construct an enrollment URL. Its output is the serializable `CourseObservation` contract from `@btu-course-watch/contracts`.

## Confirmed evidence and conservative rules

- A visible `.group_title[data-id]` supplies `btuGroupId`, an external BTU key for this project. No undocumented internal meaning is assumed.
- The suffix `name - (digits)` supplies a trimmed name and non-negative capacity. Other title text is preserved as the name with `capacity: null`.
- A group action is considered only when exactly one visible `a.chooseGroup` shares that title's `<tr>`, and the row contains exactly one visible group title. No positional matching across rows is used. If the actual page places a control elsewhere, the group remains `UNKNOWN` until verified fixture evidence supports an additional association rule.
- `AVAILABLE` requires an enabled `btn-primary` action with `data-type="choose"` and an absolute HTTPS `data-href` on exactly `classroom.btu.edu.ge` matching `/ge/student/me/choose/<digits>`, without query, fragment, or credentials. `disabled`, `aria-disabled="true"`, and a `disabled` class prevent an available classification. The URL is taken from the DOM; the selection number need not equal `btuGroupId`.
- `FULL` requires a `btn-default chooseGroup` action with a `disabled` attribute and no non-empty `data-href`. The Georgian `data-msg` may appear, but its wording is not used to decide state.
- Other or conflicting controls, multiple titles in a row, missing controls, and invalid URLs yield `UNKNOWN` and `chooseUrl: null`. A missing/blank or duplicate group key fails explicitly instead of producing a misleading observation. Groups are returned in stable ID order.
- The parser ignores structurally hidden titles and actions (`hidden`, `aria-hidden="true"`, or inline `display: none`). It cannot evaluate external stylesheets or computed visibility.

The fixture detail rows `tr-<btuGroupId>` and icons `ico-<btuGroupId>` reflect the manually noted correspondence. They are not parsed for schedule or lecturer fields: no sufficiently specific real detail-row structure was supplied. `courseName` is caller-provided context, never guessed from page text.

## Unsupported until more sanitized evidence is captured

Controls outside the title row; relative or non-`/ge/` Choose URLs; alternative action elements/classes; group titles hidden only by external CSS; and structured lecturer/schedule extraction. A real sanitized HTML sample showing the title row, its Choose control, and one expanded detail row would let us verify or safely extend these rules before extension integration. Do not add a full authenticated page or any user identity, cookies, authorization data, or tokens to fixtures.

Run `pnpm --filter @btu-course-watch/classroom-parser test` for the fixture suite. The package does not send observations to the API or persist HTML.
