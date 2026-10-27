# Atomic checkout and terminal payment records

`create-checkout` now calls the server-only `prepare_payfast_checkout` RPC. The RPC validates the private token hash and sandbox/live classification, locks an existing attempt before its order, rechecks current order state, and inserts only when no attempt exists. Pending/failed attempts retain their original status, provider ID and checkout metadata on retries. Paid, refunded, cancelled and inconsistent records cannot open another checkout through this action.

When two first checkouts overlap and an attempt appears while the second request waits for its order lock, a savepoint releases that iteration's order lock before retrying with the attempt locked first. This avoids acquiring a newly discovered attempt after holding the order while a callback could hold that attempt and wait for the order.

The payment callback now keeps completed/refunded attempts terminal after late FAILED/CANCELLED statuses. A trigger also protects completed attempts against status resets from requests already running on the previous deployment. The explicit transition from complete to refunded remains available to the audited refund action.

A distinct second verified COMPLETE provider ID is retained in `payment_events` and an audit event named `duplicate_payfast_payment_requires_review`, containing the first and additional provider IDs. It cannot overwrite the original receipt, reopen a refund or queue another paid confirmation. Reviewing that evidence and deciding on any actual refund is an operational action; this code executes no financial refund.

## Validation and rollout

- CLI-generated migration: `20261027112816_atomic_checkout_and_terminal_payments.sql`; apply before deploying the adapted endpoint.
- Four focused checks pass with `node --test test/checkout-handler.test.js`.
- `test/checkout-acceptance.sql` passes on isolated PGlite PostgreSQL as both owner and `service_role`: initial insertion, stable repeated preparation, failed retry history, paid rejection, late terminal statuses, stale status writes, distinct second-receipt event/audit evidence, no repeated confirmation jobs, refund compatibility, token/mode isolation and private RPC grants.
- Existing refund SQL acceptance also passes with this new callback implementation under both roles. All isolated acceptance fixtures roll back.
- These isolated checks do not establish a multi-connection concurrency stress test, actual PayFast callback delivery, inbox placement or production acceptance. The hosted dedicated-project rollback acceptance and provider sandbox flow remain root verification steps.

Only `api/create-checkout.js`, the new migration, focused tests and this note were changed by the checkout subtask. No live SQL, deployment or commit was performed by this subtask.
