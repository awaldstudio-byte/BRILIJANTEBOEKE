# Academic-year creation

## Implemented

The authenticated dashboard now has an Academic years section and an Add year shortcut beside the school form's year selector. An active administrator can create a whole year from 2026 to 2100, matching the existing database constraint. It is saved in the existing private academic_years table and returned to the dropdown. Viewers may read the year list but cannot create years. No database grants, public signup, authentication settings or production website changes are part of this release.

Creation uses the existing administrator-only POST /api/admin-schools action create_academic_year. The label and active flag are server-owned. The unique year constraint plus ON CONFLICT DO NOTHING prevents duplicates and never overwrites existing labels, IDs or active states. A creation audit records the authorized actor. The year and audit are separate database writes, as in the existing school workflow: an audit failure after a committed insert requires review; the error is not reported as successful creation and retrying cannot duplicate or overwrite the year.

Adding a year updates only the year dropdown/list, preserving unsaved school-profile fields. An existing period's selection stays unchanged until the user explicitly selects another year. When an existing school changes year, the UI loads that year's latest period; if none exists, it clears the period ID and prepares a separate draft requiring dates and grade choices. The server independently rejects moving an existing ordering period to another year or school. Historical school/year links are not reassigned.

This is an additive create/list feature, not year renaming, deletion, archiving, period cloning, or a full annual rollover tool. No real academic year was created by the agent for testing.

## Verification

- 98 automated tests pass; 44 JavaScript files pass source/syntax checks. Added tests cover range/type validation, active administrator authorization, saved server-owned fields, audit creation, duplicate and repeated-request behaviour, database errors, unchanged historical periods and HTTP success/access boundaries.
- A live rollback-only acceptance query in dedicated project cigyxjfzbjlgbrduzcpw passed on 22 October. It confirmed private RLS/browser-role permissions, insert behaviour, duplicate prevention without overwrites, and unchanged existing period/year links. All test data rolled back; no schema migration was required.
- The isolated local UI fixture exercised creating 2028, duplicate feedback, persistence across fixture reloads, preserving an unfinished school name/contact, choosing a new year's separate draft, and switching back to the original period with its dates/quantities intact. Only synthetic local fixture data was used.
- The changed page was visually checked on desktop, 768px tablet and 320px mobile. Mobile checking found a cramped signed-in header; a scoped narrow-screen fix keeps the language switch and sign-out control visible without horizontal document overflow. Real-device/Safari/assistive-technology coverage is not claimed.
- Actual authenticated hosted creation remains a user acceptance step. Do not take over the user's credentials, live setup or unsaved browser work. Ask them to save work before refreshing the preview.

Release scope: codex/phase1-foundation and the stable branded preview alias only. The existing public marketing site, real payments and mail activation are unchanged. Internal fixtures, tests and documentation remain excluded from public deployment.
