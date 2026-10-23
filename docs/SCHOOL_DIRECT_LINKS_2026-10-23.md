# Direct school ordering links

## Approved change

On 23 October 2026 the user confirmed that parent access codes are not needed. School catalogue access is now public through the school-specific identifier link. Anyone knowing that link can view the selected catalogue and proceed to payment when enabled. This is not staff access or permission to read existing parent/learner records. No school directory or cross-school record listing was added.

## Implementation

- Identifier-only links open directly. No parent signup, password or access-code form is shown.
- The school form always offers Open school page and Copy link for a saved ordering period. The generation/revocation checkbox, code field, copy-code control, one-time-link warning and list code hints were removed. Prepared emails contain the link, not a code.
- Staff-generated links include the specific ordering-period ID, preserving the selected academic year. An unsaved new year does not display a link to another year's period. Saving an older year keeps that period selected.
- A generic identifier-only link prefers an open period for the school; otherwise it shows the unavailable/closed state. Explicit period links never silently change years or schools.
- Public responses contain catalogue details only; internal access hashes, expected quantities and school contact fields are not returned.
- Existing transactional order creation still runs through the service-only database RPC with authoritative prices and school/grade/date checks. The server resolves the internal school/period hash; parents never supply or receive it in the direct-link flow. Existing school_access records remain as a compatibility bridge, not a parent authentication step. Saving a school's period synchronizes this internal record's expiry with the closing date.
- Legacy code-bearing links remain compatible. No existing code, account, school or order was deleted, revoked or regenerated during verification.
- Checkout remains disabled when PayFast is unconfigured. Staff authentication, sessions, MFA handling and report authorization are unchanged.

## Evidence

- 114 automated tests pass; 47 JavaScript files checked. Includes direct identifier access, no internal/private fields, unknown and inactive schools, year/school isolation, closed/future periods, legacy compatibility, client/server payment gating and an injected-database order/RPC round trip. Server-provided hash and amount prevail over supplied hash/price fields.
- Final deployment dpl_FfmUsavKZjGqNbz6MDH9X6FC6nuG is Ready; stable branded preview alias assigned. No promotion to the public marketing domain, database schema/RLS change, mail activation or payment activation.
- Actual test-school direct and period-specific API requests return Test School 1, the 2027 period, open=true, seven grades and payments_enabled=false. Unknown identifiers and a foreign period return 404.
- Browser direct links load in English and Afrikaans with zero access-code fields. Authenticated dashboard shows the school's direct link and Copy link, without code controls. No live school save or order creation was performed.
- Parent page: no horizontal overflow at observed widths 677 and 390 pixels; admin share controls checked at 390. Earlier order-layout checks remain in the superseded record, but no claim of retesting every prior viewport or physical device is made.
- Unsigned school administration/export requests return 401. Internal implementation remains 404. No private record was published.
- Screenshots in the workspace outputs/school-order-access directory: no-code-desktop.png, no-code-mobile.png, no-code-admin.png. These are UI evidence, not a security certification.

## Remaining acceptance

Live financial checkout awaits PayFast. New school persistence and historical-year save selection were not exercised by writing test data into the client's database in this pass. Existing transactional database constraints remain in place; no new anonymous grants were introduced.
