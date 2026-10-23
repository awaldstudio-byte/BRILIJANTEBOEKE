# School ordering access

## Changes

Open school periods now show their workbook catalogue and allow in-browser completion of the order steps when PayFast is unconfigured. A bilingual notice explains the restriction. The payment button and direct client payment handler remain disabled; the existing server payment-configuration gate still rejects order creation before any database write. This does not activate payments, order confirmations or real order capture.

The school link identifier now has an actual entry URL: `/order/?identifier=<saved-slug>&lang=en`. It asks for the private school code. Newly generated private links include both the identifier and the code; the server rejects mismatched identifiers before returning catalogue details. Legacy code-only links continue to work. Knowing an identifier does not provide access, and no slug-to-private-code lookup has been introduced.

Saved school forms show a reusable entry link after selecting a school, including after reload. Newly generated private links have an Open ordering page action. Full private codes are still only returned at generation, stored hashed, and never recovered from the identifier. Duplicate identifiers receive a specific conflict response. Existing codes were not rotated or revoked.

## Verification

- 110 automated tests pass; 46 JavaScript files checked. Includes open/closed/draft/future/past periods, inactive schools, missing/invalid/revoked/expired codes, identifier mismatch, legacy links, duplicate/invalid identifiers and both client/server payment gates.
- Preview deployment `dpl_6UdTWnX71fchESEL9x6hFVZTQWbF` is Ready and assigned to the existing branded preview alias. No marketing-domain promotion or environment-variable change was made.
- Actual test-school API returns open=true and payments_enabled=false. A different identifier with the same code returns 404.
- Live browser: existing test school displays all seven configured grades, with no missing images. Two synthetic learners in Grades 1 and 2 produce R640; parent details and review are reachable, and payment remains disabled. No order was submitted or created.
- Identifier-only page requests the code. Entering the matching code in lowercase normalizes it and opens the correct school. No code has been regenerated during testing.
- No horizontal overflow at 1280, 768, 390 or 320 pixels in the checked ordering states. Desktop and mobile review screenshots saved outside the public repository under outputs/school-order-access. These are desktop browser viewport checks, not physical-device or Safari certification.
- Refreshed authenticated dashboard displays the saved test school and its reusable entry link. Existing dashboard reports zero orders after testing.
- Hosted order/admin scripts, shared link module and stylesheet match local sources. Test files and API implementation paths return 404; unsigned staff-school requests remain 401.

## Remaining acceptance

Actual new-code issuance, code rotation, a live school rename and an authenticated duplicate-school save were not performed against client data; those save paths have automated coverage. New code links will include the current saved identifier. If an identifier is later renamed, use the updated named entry link; legacy code-only links remain valid while their access code is valid. PayFast configuration and end-to-end provider payment tests remain separate work.
