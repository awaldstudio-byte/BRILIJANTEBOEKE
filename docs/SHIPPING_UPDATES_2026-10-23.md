# School batch shipping updates

## Behaviour

Parents receive two transactional updates: books dispatched to their school, and books delivered to their school. Delivery never claims collection by a parent or learner. No courier tracking link, delivery date or collection promise is invented.

The administrator confirms the status change in Fulfilment. The frozen school batch is the source of each notification: later payments stay outside it. Children/books are grouped by normalized parent mailbox, giving one notification per mailbox, batch and event. Names, quantities and references come from actual batch items, not placeholder records. Read-only email previews are available before dispatch.

The approved Briljante logo is embedded inline, with the existing gray surround, white card, navy typography, turquoise accent and bilingual copy. There are no tracking images, staff links or school-wide financial data in parent mail.

## Security and delivery handling

- All dashboard reads retain staff authentication; mutations require administrator authorization and same-origin checks. Anonymous email previews are rejected.
- Status changes, immutable recipient snapshots and the audit event are committed together under a batch row lock. A unique batch/event/mailbox key prevents duplicate event jobs.
- The outbox has RLS and no PUBLIC, anonymous or authenticated client privileges. Its functions are security invoker, fixed search-path and executable only by service_role.
- Queued jobs are claimed atomically with SKIP LOCKED. A job has at most one SMTP submission attempt. A deterministic Message-ID is used, but SMTP cannot guarantee exactly-once inbox delivery.
- Delivery updates wait while that recipient's dispatch update is queued or processing. Failed or abandoned processing jobs are shown for technical review, not blindly retried.
- `Sent` means accepted by the configured outgoing mail server, not confirmed inbox delivery. A send accepted before an outcome-save failure requires reconciliation.
- Hosted work uses bounded chunks and signed, batch-bound, short-lived continuation requests to the canonical same-origin API path. It continues without the dashboard remaining open. There is no new cron, provider, billable queue or public worker credential.
- A failed continuation leaves durable queued jobs. An administrator can use Send pending updates to resume only untouched jobs; uncertain jobs require review. Chains are bounded to 500 continuations.

## Preview safeguards

The exact dedicated Supabase project, preview origin and preview flags must match. DEMO shipping is restricted to Test School 1 and the approved technical administrator. Every DEMO email is routed to technical@awaldstudio.com and clearly identifies that no physical shipping occurred. Real parent shipping mail is blocked on preview. Production mail additionally requires the approved domain, production environment and configured enabled sender.

No shipping emails were sent during implementation verification. Existing test batch `5bfa64e1-2758-4897-8905-a655de9907ff` was inspected read-only and left Created. No real orders or payments were generated.

## Verification

- `npm run check`: 68 JavaScript files checked; 175 tests passed.
- Live transactional acceptance script `test/shipping-acceptance.sql`: PASS for fixed-school grouping, late-order exclusion, duplicate protection, event sequencing, terminal transitions and private privileges. All synthetic test records rolled back.
- Live catalog readback: notification job count 0, RLS true, anonymous/authenticated table reads false, anonymous worker execution false, authenticated transition execution false.
- Deployed endpoint checks: anonymous email preview 401; forged worker request 403. Canonical worker path verified to avoid the site's trailing-slash redirect.
- Authenticated live batch previews rendered successfully for dispatch and school delivery. Desktop and 320-pixel email layouts inspected. The existing staff session and dashboard totals remained intact.
- Evidence: workspace `outputs/shipping-updates/` contains database and browser screenshots. Email renderer fixture server makes no database or SMTP calls.

## Deployment and remaining acceptance

SQL migration `20261023120847_school_shipping_notifications.sql` was applied to dedicated project cigyxjfzbjlgbrduzcpw using its authenticated SQL editor. The stable preview is briljante-preview-awaldstudio.vercel.app; the marketing domain was not deployed.

User acceptance should inspect the two preview links under Fulfilment and, when ready, confirm dispatch and delivery on the DEMO batch. That is the remaining actual-mail inbox test; it was not silently performed. Before production launch, confirm final fulfilment operations, mail sender and production-domain deployment, then conduct an approved controlled delivery check.
