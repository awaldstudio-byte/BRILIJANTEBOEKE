# Demo payments and order confirmations

## Scope and recipient decisions

User approved testing the order flow without PayFast and asked for parent order confirmation and staff payment confirmation matching the approved verification-email design. The user then clarified that the parent confirmation must go to the address entered in checkout, not a fixed technical recipient. Only the staff test notification is redirected to technical@awaldstudio.com.

Both messages use the exact approved Briljante logo as a CID attachment, grey surround, white card, navy type, quiet turquoise rule, amount/reference panel, school/year, learner/workbook lines and delivery explanation. Complete plain-text alternatives remain. Staff also receives the parent's contact and a working authenticated dashboard link. No remote tracking images, credentials or order-access tokens are in emails. Live confirmations remain conditional on a verified paid order; demo confirmations are prominently labelled and never claim actual payment receipt.

## Demo boundaries

- DEMO_PAYMENTS_ENABLED=true must be supplied explicitly to a preview deployment. It was provided only as a deployment override, not as a persistent project-wide variable. Future deployments need an explicit decision to retain it.
- Exact APP_ORIGIN https://briljante-preview-awaldstudio.vercel.app, VERCEL_ENV=preview and dedicated Supabase project cigyxjfzbjlgbrduzcpw are required.
- Existing approved administrator session for technical@awaldstudio.com, normal provider verification and same-origin protections remain mandatory. Anonymous visitors and other staff do not receive demo availability.
- Only existing Test School 1 (edabcd03-1854-43ca-ac93-45c71e9ef012) may use the demo. The school must still be open; prices, learner offerings and totals come from the usual database transaction, not browser totals.
- Checkout requests confirmation before submitting. Cancel/Escape submits nothing. The server requires confirm_demo=true and enforces a durable 20-request/hour technical-operator quota.
- Demo uses the existing /api/orders endpoint to stay inside the current hosting function limit. The initial separate-function deployment failed the 12-function limit; it was not aliased. No subscription upgrade was made.
- Orders are namespaced with a demo: idempotency key and a DEMO- reference, then recorded as paid strictly for test-school workflow testing. No PayFast attempt or fabricated PayFast event is created. Normal order creation and checkout remain gated on PayFast configuration.
- Notification primary keys are deterministic per order and kind. Upsert ignores duplicates; existing processing/sent/failed records are never reset. Normal compare-and-set claims prevent concurrent duplicate sends. Ambiguous SMTP failures require review rather than automatic resend.
- DEMO orders are included in preview figures while demo mode is active, with a dashboard warning. When disabled, DEMO references are excluded from financial overview order counts and totals. Test-school records can still appear in operational lists, grade progress and test exports: archive/reconcile the test school and test records before real launch. This is not an accounting certification or a production clean-up operation.
- No schema/RLS/MX/credential changes or marketing-domain deployment were made. MAIL_ENABLED remains unchanged; the restricted demo handler uses the existing SMTP configuration only for its two scoped test jobs.

## Verification

132 automated tests pass, covering existing functionality plus demo environment/identity denial, unconfirmed requests, school isolation, quota denial, server prices, typed parent recipient, fixed staff recipient, repeated submissions, uncertain SMTP outcomes, HTML escaping, complete MIME and the exact inline logo. Real-payment guard tests still pass.

Both email layouts were visually reviewed at normal desktop width and at 768px and 320px using local same-origin iframe viewports, including complete content and footer. No clipped or overlapping content was observed. These are browser design checks, not certification of physical-device or mail-client rendering.

Hosted internal test: DEMO-BB-26-9516E62D, two fictional learners (Grades 1 and 5), R660 simulated total. Parent email was deliberately entered as technical@awaldstudio.com for this single internal test; this is not a form default. Mail server accepted both messages. Order-status page confirms demo/no charge. Dashboard showed exactly one paid test order, one paid Grade 1 learner and one paid Grade 5 learner, matching expected quantity two for each grade. No second live test was submitted.

Anonymous demo POST returned 401; anonymous public catalogue returned payments_enabled=false and demo_payments_enabled=false; internal handler source returned 404. Inbox receipt, Gmail/Outlook/Apple Mail and dark-mode rendering need recipient confirmation and are not established by SMTP acceptance or browser design screenshots.

Initial successful deployment: dpl_DWUczL9L4T3PkasE51u76mwTC1r7. Follow-up dashboard-label/financial-overview refinement: dpl_B915Zp9AT78UjhXbQ3xJL1K61qM1. Stable branded preview alias only; no production release. Screenshot evidence is under task outputs/school-materials/order-testing.

## Staff progress correction

Latest preview dpl_2V1k4xGhxRDYT1Co6kkxt9vJWfGu adds mandatory school-period progress to staff notifications only. Expected/paid/outstanding book counts and monetary values are calculated from current active expected allocations and actual paid order-item snapshots, with a per-grade count table and South African snapshot timestamp. Outstanding values/quantities are clamped per grade, so extra payments for one grade cannot offset a different grade's shortfall. Expected values are estimates from configured prices, not claims about identified unpaid learners. Refund/cancelled/pending orders are excluded; demo and real reference categories never mix in this calculation. Parent emails remain restricted to their own order, and recipient routing is unchanged.

Queries paginate explicitly beyond the API's first result page and fail closed rather than silently sending truncated totals. A progress lookup failure marks the staff job for review; it cannot fall back to an incomplete staff email or retry uncertain sends automatically. No schema, permissions or payment state changes were necessary.

138 automated checks pass, including cross-school/year/status isolation, 1001-line pagination, demo/live separation, actual-price sums, inactive offerings, nonnegative grade shortfalls and parent privacy. Desktop, 768px and 320px browser render checks completed; a narrow-table heading wrap was corrected. Authenticated read-only email preview of the already saved DEMO-BB-26-9516E62D verified actual live data: 14 expected books, 2 paid, 12 outstanding; expected value R4640, simulated paid R660 and outstanding R3980. Both Grade 1 and Grade 5 show 1 paid and 1 outstanding; other grades show 0 paid and 2 outstanding. Anonymous preview returns 401. No new order or email was submitted for this correction. Evidence: outputs/school-materials/order-testing/staff-progress-live.png.

The read-only preview is /api/admin-orders?email_preview=ORDER_REFERENCE and requires the existing approved staff session. It renders the same staff template with inline logo and restrictive CSP, without SMTP, order writes or notification-queue writes. The latest deployment is assigned to the stable branded preview alias with the explicit demo switch retained.

User subsequently asked whether a grade-confirmation popup should precede payment. Recommended showing each learner's selected grade for the target academic year with Edit details and Confirm and continue. This extra grade-review popup has not been implemented; the existing demo-payment confirmation remains unchanged.
